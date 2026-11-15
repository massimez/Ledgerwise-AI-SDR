import {
	type DiscoveryCandidateExtraction,
	discoveryBatchExtractionSchema,
	resolveSdrModelConfig,
	runSdrAgentWithFallback,
} from "../../agents";
import { verifyQuoteAgainstSource } from "../../guards";
import { normalizeDomain } from "../../shared/domain";
import type {
	AgentRunTelemetry,
	RawSourceDocument,
	SdrPipelineLogger,
} from "../../shared/types";
import {
	AT_COMPANY_TITLE_REGEX,
	doesCompanyNameMatchHostname,
	doesTextReferToCompany,
	EMAIL_IN_TEXT_REGEX,
	HIRING_ORG_JSONLD_REGEX,
	isThirdPartySignalHost,
	JOB_BOARD_TITLE_SUFFIX_REGEX,
	JSONLD_NAME_REGEX,
	JSONLD_URL_REGEX,
	looksLikeThirdPartyDirectoryDoc,
	NON_ALNUM_SEP_REGEX,
	sanitizeCompanyDomain,
	URL_IN_TEXT_REGEX,
} from "./domain-matching";
import { searchExaSources } from "./http-client";

const NON_US_COUNTRY_TLD_REGEX =
	/\.(?:co\.uk|org\.uk|com\.au|net\.au|co\.nz|ca|de|fr|nl|es|it|se|dk|no|jp|in|br|mx)$/iu;
const PUBLIC_STOCK_TICKER_REGEX =
	/\b(?:NASDAQ|NYSE|TSX|LSE)\s*:\s*[A-Z]{2,5}\b/u;

export function getFirstPartyHostFromUrl(url: string): string | null {
	try {
		return sanitizeCompanyDomain(new URL(url).hostname);
	} catch {
		return null;
	}
}

function formatBrandLabel(slug: string): string {
	return slug
		.split(NON_ALNUM_SEP_REGEX)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

const IGNORED_ATS_PATH_SEGMENTS = new Set(["jobs", "job", "embed", "company"]);
const IGNORED_ATS_SUBDOMAINS = new Set([
	"boards",
	"job-boards",
	"apply",
	"jobs",
]);

function inferCompanyNameFromUrl(url: string, fallbackTitle: string): string {
	try {
		const parsed = new URL(url);
		const host = normalizeDomain(parsed.hostname);
		if (isThirdPartySignalHost(host)) {
			const [firstSegment] = parsed.pathname.split("/").filter(Boolean);
			if (firstSegment && !IGNORED_ATS_PATH_SEGMENTS.has(firstSegment)) {
				return formatBrandLabel(firstSegment);
			}
			const [sub] = host.split(".");
			if (sub && !IGNORED_ATS_SUBDOMAINS.has(sub)) {
				return formatBrandLabel(sub);
			}
		}
		const [brandLabel] = host.split(".");
		return formatBrandLabel(brandLabel ?? host) || host;
	} catch {
		return fallbackTitle || "Unknown Company";
	}
}

function inferCompanyNameFromTitleAndUrl(doc: RawSourceDocument): string {
	const cleanedTitle = doc.title
		.replace(JOB_BOARD_TITLE_SUFFIX_REGEX, "")
		.trim();
	const atMatch = AT_COMPANY_TITLE_REGEX.exec(cleanedTitle);
	const atCompany = atMatch?.groups?.company?.trim();
	if (atCompany && atCompany.length >= 2) {
		return atCompany;
	}

	for (const sep of [" — ", " – ", " - ", " | "]) {
		if (!cleanedTitle.includes(sep)) {
			continue;
		}
		const [firstPart, secondPart] = cleanedTitle
			.split(sep)
			.map((part) => part.trim())
			.filter(Boolean);
		if (
			secondPart &&
			firstPart &&
			firstPart.length >= 2 &&
			firstPart.length <= 80
		) {
			return firstPart;
		}
	}

	return inferCompanyNameFromUrl(doc.url, cleanedTitle);
}

function extractDomainFromTextOrJsonLd(text: string): {
	companyDomain: string | null;
	companyName: string | null;
} {
	let jsonLdName: string | null = null;
	const orgMatch = HIRING_ORG_JSONLD_REGEX.exec(text);
	if (orgMatch?.groups?.block) {
		const nameMatch = JSONLD_NAME_REGEX.exec(orgMatch.groups.block);
		jsonLdName = nameMatch?.groups?.name?.trim() ?? null;
		const urlMatch = JSONLD_URL_REGEX.exec(orgMatch.groups.block);
		const jsonLdDomain = sanitizeCompanyDomain(urlMatch?.groups?.url);
		if (jsonLdDomain) {
			return { companyDomain: jsonLdDomain, companyName: jsonLdName };
		}
	}

	for (const match of text.matchAll(EMAIL_IN_TEXT_REGEX)) {
		const emailDomain = sanitizeCompanyDomain(match.groups?.host);
		if (emailDomain) {
			return { companyDomain: emailDomain, companyName: jsonLdName };
		}
	}

	for (const match of text.matchAll(URL_IN_TEXT_REGEX)) {
		const urlDomain = sanitizeCompanyDomain(match[0]);
		if (urlDomain) {
			return { companyDomain: urlDomain, companyName: jsonLdName };
		}
	}

	return { companyDomain: null, companyName: jsonLdName };
}

export function extractDiscoveryMetadataDeterministic(
	doc: RawSourceDocument,
	resultIndex: number
): DiscoveryCandidateExtraction {
	const fromText = extractDomainFromTextOrJsonLd(doc.text);
	const companyName =
		fromText.companyName ?? inferCompanyNameFromTitleAndUrl(doc);
	const rawDocHost = getFirstPartyHostFromUrl(doc.url);
	const matchedFirstPartyHost =
		rawDocHost && doesCompanyNameMatchHostname(companyName, rawDocHost)
			? rawDocHost
			: null;
	// Do not fall back to a mismatched host's own URL/email from the snippet.
	const snippetDomain =
		fromText.companyDomain &&
		rawDocHost &&
		fromText.companyDomain === rawDocHost &&
		!doesCompanyNameMatchHostname(companyName, fromText.companyDomain)
			? null
			: fromText.companyDomain;
	const companyDomain = snippetDomain ?? matchedFirstPartyHost;
	const evidenceQuote = doc.text.trim().slice(0, 320);

	return {
		companyDomain,
		companyName,
		evidenceQuote,
		resultIndex,
	};
}

export async function extractDiscoveryBatchWithOptionalLlm(params: {
	docs: RawSourceDocument[];
	googleApiKey?: string;
	logger?: SdrPipelineLogger;
	openrouterApiKey?: string;
	requireLlm?: boolean;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
}): Promise<Map<number, DiscoveryCandidateExtraction>> {
	const resultsByIndex = new Map<number, DiscoveryCandidateExtraction>();
	if (params.docs.length === 0) {
		return resultsByIndex;
	}

	const modelConfig = resolveSdrModelConfig({
		googleApiKey: params.googleApiKey,
		openrouterApiKey: params.openrouterApiKey,
		sdrGeminiModel: params.sdrGeminiModel,
		sdrModelFast: params.sdrModelFast,
	});

	if (!(modelConfig.llmEnabled || params.requireLlm)) {
		params.logger?.info(
			"SdrDiscovery",
			"Using deterministic discovery entity extraction (no LLM key enabled)",
			{ resultCount: params.docs.length }
		);
		return resultsByIndex;
	}

	const telemetry: AgentRunTelemetry[] = [];
	const bundle = params.docs
		.map(
			(doc, index) =>
				`[Result ${index}] URL=${doc.url}\nTITLE=${doc.title}\nTEXT=${doc.text.slice(0, 2400)}`
		)
		.join("\n\n---\n\n");

	try {
		const extracted = await runSdrAgentWithFallback({
			agentKey: "discoveryExtractorAgent",
			models: modelConfig.fastModels,
			prompt: `For each Exa search result below, extract the hiring/target company's real name (companyName), its official domain ONLY if explicitly present in the title/text/JSON-LD (companyDomain), a verbatim snippet from the text (evidenceQuote), and preScreenStatus ('pass' or 'disqualified' with preScreenReason). Only set preScreenStatus='disqualified' if the snippet clearly shows a non-US HQ, non-ecommerce business (e.g. staffing agency/SaaS/directory), or public/enterprise >250-person company; otherwise set preScreenStatus='pass'. NEVER output job board, aggregator, ATS, or social domains (such as univision.com, a16z.com, trabajos.*, jobs.*, greenhouse.io, lever.co, ashbyhq.com, workable.com, bamboohr.com, breezy.hr, linkedin.com, wellfound.com, builtin.com, simplify.jobs, indeed.com, glassdoor.com, rrm.com, ecom.jobs, jobrack.eu, zunohire.com, meterwork.com, jobsearcher.com, opentoworkremote.com, career.io) as companyDomain — set companyDomain to null instead.\n\n${bundle}`,
			schema: discoveryBatchExtractionSchema,
			summarizeOutput: (output) =>
				`${output.candidates.length} discovery entities extracted`,
			telemetry,
			telemetryAgentName: "discovery_extractor",
		});

		for (const item of extracted.candidates) {
			resultsByIndex.set(item.resultIndex, item);
		}
		params.logger?.info(
			"SdrDiscovery",
			"Extracted discovery entities with structured LLM",
			{
				extractedCount: resultsByIndex.size,
				model: telemetry.at(-1)?.model ?? null,
				totalDocs: params.docs.length,
			}
		);
	} catch (error) {
		if (params.requireLlm) {
			throw error;
		}
		params.logger?.warn(
			"SdrDiscovery",
			"Structured LLM discovery extraction failed; falling back to deterministic parsing",
			{
				error: error instanceof Error ? error.message : String(error),
				resultCount: params.docs.length,
			}
		);
	}

	return resultsByIndex;
}

export async function lookupCompanyDomainViaExa(options: {
	apiKey: string;
	cache: Map<string, string | null>;
	companyName: string;
	logger?: SdrPipelineLogger;
}): Promise<string | null> {
	const cacheKey = options.companyName.trim().toLowerCase();
	if (cacheKey.length < 2) {
		return null;
	}
	if (options.cache.has(cacheKey)) {
		return options.cache.get(cacheKey) ?? null;
	}

	const lookupDocs = await searchExaSources({
		allowShortText: true,
		apiKey: options.apiKey,
		category: "company",
		logger: options.logger,
		numResults: 5,
		purpose: "company_domain_lookup",
		query: options.companyName,
	});

	let hostMatchedDomain: string | null = null;
	let contentMatchedDomain: string | null = null;
	const rejectedResults: Array<{
		reason: string;
		title: string;
		url: string;
	}> = [];

	for (const doc of lookupDocs) {
		const host = getFirstPartyHostFromUrl(doc.url);
		if (!host) {
			rejectedResults.push({
				reason: "third_party_or_directory_host",
				title: doc.title,
				url: doc.url,
			});
			continue;
		}
		const hostMatches = doesCompanyNameMatchHostname(options.companyName, host);
		const titleMatches = doesTextReferToCompany(options.companyName, doc.title);
		const textMatches = doesTextReferToCompany(options.companyName, doc.text);

		if (hostMatches && (titleMatches || textMatches)) {
			hostMatchedDomain = host;
			break;
		}
		if (titleMatches && textMatches && !looksLikeThirdPartyDirectoryDoc(doc)) {
			contentMatchedDomain ??= host;
			continue;
		}
		rejectedResults.push({
			reason: "company_name_mismatch",
			title: doc.title,
			url: doc.url,
		});
	}

	const resolvedDomain = hostMatchedDomain ?? contentMatchedDomain;

	options.cache.set(cacheKey, resolvedDomain);
	options.logger?.info(
		"SdrDiscovery",
		"Resolved company domain via Exa company lookup",
		{
			companyName: options.companyName,
			lookupUrlCount: lookupDocs.length,
			rejectedResults,
			resolvedDomain,
		}
	);
	return resolvedDomain;
}

export function resolveVerifiedDiscoveryQuote(
	candidateQuote: string | undefined,
	docText: string
): string {
	const trimmedCandidate = candidateQuote?.trim();
	if (
		trimmedCandidate &&
		trimmedCandidate.length >= 12 &&
		verifyQuoteAgainstSource(trimmedCandidate, docText)
	) {
		return trimmedCandidate.slice(0, 500);
	}
	return docText.trim().slice(0, 320);
}

/**
 * Evaluate whether an Exa discovery snippet or resolved domain is unambiguously
 * disqualified before launching full multi-source company research.
 */
export function evaluateDiscoveryPreScreen(params: {
	doc: RawSourceDocument;
	llm?: DiscoveryCandidateExtraction;
	resolvedDomain?: string | null;
}): { disqualified: boolean; reason: string | null } {
	if (params.llm?.preScreenStatus === "disqualified") {
		return {
			disqualified: true,
			reason:
				params.llm.preScreenReason?.trim() || "Failed pre-research ICP screen",
		};
	}

	if (
		params.resolvedDomain &&
		NON_US_COUNTRY_TLD_REGEX.test(params.resolvedDomain)
	) {
		return {
			disqualified: true,
			reason: `Non-US country domain (${params.resolvedDomain})`,
		};
	}

	const combinedSnippet = `${params.doc.title}\n${params.doc.text.slice(0, 2400)}`;
	if (PUBLIC_STOCK_TICKER_REGEX.test(combinedSnippet)) {
		return {
			disqualified: true,
			reason: "Publicly traded enterprise",
		};
	}

	return { disqualified: false, reason: null };
}

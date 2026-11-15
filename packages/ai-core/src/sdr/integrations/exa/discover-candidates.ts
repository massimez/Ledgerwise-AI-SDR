import type {
	DiscoveryNicheId,
	DiscoveryPreFilteredBreakdown,
} from "../../../contracts";
import type { DiscoveryCandidateExtraction } from "../../agents";
import { normalizeDomain } from "../../shared/domain";
import type { RawSourceDocument, SdrPipelineLogger } from "../../shared/types";
import {
	CURATED_US_ECOMMERCE_PROSPECTS,
	type DiscoveredProspectCandidate,
} from "../sandbox-fixtures";
import {
	doesCompanyNameMatchHostname,
	sanitizeCompanyDomain,
} from "./domain-matching";
import {
	evaluateDiscoveryPreScreen,
	extractDiscoveryBatchWithOptionalLlm,
	extractDiscoveryMetadataDeterministic,
	getFirstPartyHostFromUrl,
	lookupCompanyDomainViaExa,
	resolveVerifiedDiscoveryQuote,
} from "./entity-extractor";
import {
	buildDiscoveryExcludeDomains,
	DISCOVERY_EXA_NUM_RESULTS,
	EXA_LOOKUP_CONCURRENCY,
	searchExaSources,
} from "./http-client";
import {
	buildDiscoveryQueryPlan,
	buildDiscoverySearchQuery,
	type DiscoverySignalPreset,
	resolveDiscoveryStartPublishedDate,
} from "./query-planner";

function scoreCuratedCandidateMatch(
	candidate: DiscoveredProspectCandidate,
	signalPreset?: DiscoverySignalPreset,
	keyword?: string
): number {
	const text = [
		candidate.name,
		candidate.location ?? "",
		candidate.channels.join(" "),
		...(candidate.seedDocuments ?? []).map((doc) => `${doc.title} ${doc.text}`),
	]
		.join(" ")
		.toLowerCase();

	let score = 0;
	if (signalPreset === "hiring_finance_ops") {
		if (
			text.includes("hiring") ||
			text.includes("accountant") ||
			text.includes("finance") ||
			text.includes("jobs.")
		) {
			score += 2;
		}
	} else if (signalPreset === "recent_funding") {
		if (
			text.includes("seed") ||
			text.includes("raised") ||
			text.includes("funding") ||
			text.includes("series")
		) {
			score += 2;
		}
	} else if (
		signalPreset === "channel_expansion" &&
		(text.includes("amazon") ||
			text.includes("wholesale") ||
			text.includes("tiktok") ||
			text.includes("retail") ||
			text.includes("expanding"))
	) {
		score += 2;
	}

	const normalizedKeyword = keyword?.trim().toLowerCase();
	if (normalizedKeyword && text.includes(normalizedKeyword)) {
		score += 3;
	}

	return score;
}

type DomainResolutionSource =
	| "llm_extracted"
	| "first_party_url"
	| "deterministic_snippet"
	| "exa_company_lookup"
	| "unresolved";

interface PreparedDiscoveryItem {
	companyName: string;
	directDomain: string | null;
	doc: RawSourceDocument;
	evidenceQuote: string;
	llm?: DiscoveryCandidateExtraction;
	preScreenDisqualified: boolean;
	preScreenReason: string | null;
	resolutionSource: DomainResolutionSource;
}

function prepareDiscoveryItem(
	doc: RawSourceDocument,
	index: number,
	llm: DiscoveryCandidateExtraction | undefined,
	logger?: SdrPipelineLogger
): PreparedDiscoveryItem {
	const deterministic = extractDiscoveryMetadataDeterministic(doc, index);
	const companyName = (
		llm?.companyName?.trim() || deterministic.companyName
	).trim();
	const llmDomain = sanitizeCompanyDomain(llm?.companyDomain);
	const rawFirstPartyDomain = getFirstPartyHostFromUrl(doc.url);
	const firstPartyMatchesCompany =
		rawFirstPartyDomain !== null &&
		doesCompanyNameMatchHostname(companyName, rawFirstPartyDomain);
	const firstPartyDomain = firstPartyMatchesCompany
		? rawFirstPartyDomain
		: null;
	const rawDeterministicDomain = sanitizeCompanyDomain(
		deterministic.companyDomain
	);
	const deterministicDomain =
		rawDeterministicDomain &&
		!(
			rawFirstPartyDomain &&
			rawDeterministicDomain === rawFirstPartyDomain &&
			!firstPartyMatchesCompany
		)
			? rawDeterministicDomain
			: null;

	let directDomain: string | null = null;
	let resolutionSource: DomainResolutionSource = "unresolved";

	if (llmDomain) {
		directDomain = llmDomain;
		resolutionSource = "llm_extracted";
	} else if (firstPartyDomain) {
		directDomain = firstPartyDomain;
		resolutionSource = "first_party_url";
	} else if (deterministicDomain) {
		directDomain = deterministicDomain;
		resolutionSource = "deterministic_snippet";
	} else if (rawFirstPartyDomain && !firstPartyMatchesCompany) {
		logger?.info(
			"SdrDiscovery",
			"Skipping mismatched first_party_url in favor of Exa company lookup",
			{
				companyName,
				evidenceUrl: doc.url,
				mismatchedHost: rawFirstPartyDomain,
			}
		);
	}

	const preScreen = evaluateDiscoveryPreScreen({
		doc,
		llm,
		resolvedDomain: directDomain,
	});

	return {
		companyName,
		directDomain,
		doc,
		evidenceQuote: resolveVerifiedDiscoveryQuote(
			llm?.evidenceQuote ?? deterministic.evidenceQuote,
			doc.text
		),
		llm,
		preScreenDisqualified: preScreen.disqualified,
		preScreenReason: preScreen.reason,
		resolutionSource,
	};
}

function resolveFinalSource(
	item: PreparedDiscoveryItem,
	resolvedDomain: string | null
): DomainResolutionSource {
	if (item.directDomain !== null) {
		return item.resolutionSource;
	}
	return resolvedDomain ? "exa_company_lookup" : "unresolved";
}

interface LiveExaDiscoveryOptions {
	exaApiKey: string;
	googleApiKey?: string;
	logger?: SdrPipelineLogger;
	openrouterApiKey?: string;
	requireLlm?: boolean;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	startPublishedDate?: string;
	targetCount: number;
}

export type DiscoverySkipReason =
	| "domain_unresolved"
	| "duplicate_domain"
	| "duplicate_url"
	| "icp_pre_screen";

export interface SkippedDiscoveryResult {
	companyName: string;
	detail?: string | null;
	reason: DiscoverySkipReason;
	resolvedDomain: string | null;
	url: string;
}

export interface DiscoveryBatchSummary {
	acceptedCount: number;
	exaSuggestedCount: number;
	preFilteredBreakdown: DiscoveryPreFilteredBreakdown;
	preFilteredCount: number;
	rawExaDocsReturned: number;
	skippedResults: SkippedDiscoveryResult[];
}

export interface DiscoveryBatchResult {
	candidates: DiscoveredProspectCandidate[];
	summary: DiscoveryBatchSummary;
}

function buildDiscoveryBatchSummary(params: {
	candidates: DiscoveredProspectCandidate[];
	rawExaDocsReturned: number;
	skippedResults: SkippedDiscoveryResult[];
}): DiscoveryBatchSummary {
	const preFilteredBreakdown: DiscoveryPreFilteredBreakdown = {
		duplicateDomain: 0,
		duplicateUrl: 0,
		icpPreScreen: 0,
		unresolvedDomain: 0,
	};
	for (const skipped of params.skippedResults) {
		switch (skipped.reason) {
			case "duplicate_domain":
				preFilteredBreakdown.duplicateDomain += 1;
				break;
			case "duplicate_url":
				preFilteredBreakdown.duplicateUrl += 1;
				break;
			case "icp_pre_screen":
				preFilteredBreakdown.icpPreScreen += 1;
				break;
			case "domain_unresolved":
				preFilteredBreakdown.unresolvedDomain += 1;
				break;
			default:
				break;
		}
	}
	const acceptedCount = params.candidates.length;
	const preFilteredCount = params.skippedResults.length;
	return {
		acceptedCount,
		exaSuggestedCount: acceptedCount + preFilteredCount,
		preFilteredBreakdown,
		preFilteredCount,
		rawExaDocsReturned: params.rawExaDocsReturned,
		skippedResults: params.skippedResults,
	};
}

async function runChunkedDomainLookups(params: {
	apiKey: string;
	cache: Map<string, string | null>;
	logger?: SdrPipelineLogger;
	names: string[];
	offset: number;
}): Promise<void> {
	if (params.offset >= params.names.length) {
		return;
	}
	const batch = params.names.slice(
		params.offset,
		params.offset + EXA_LOOKUP_CONCURRENCY
	);
	await Promise.all(
		batch.map((companyName) =>
			lookupCompanyDomainViaExa({
				apiKey: params.apiKey,
				cache: params.cache,
				companyName,
				logger: params.logger,
			})
		)
	);
	await runChunkedDomainLookups({
		...params,
		offset: params.offset + EXA_LOOKUP_CONCURRENCY,
	});
}

async function resolveMissingCandidateDomains(
	prepared: PreparedDiscoveryItem[],
	options: Pick<LiveExaDiscoveryOptions, "exaApiKey" | "logger">
): Promise<Map<string, string | null>> {
	const lookupCache = new Map<string, string | null>();
	const uniqueNamesToLookup = Array.from(
		new Set(
			prepared
				.filter(
					(item) =>
						!(item.directDomain || item.preScreenDisqualified) &&
						item.companyName.length >= 2
				)
				.map((item) => item.companyName)
		)
	);
	if (uniqueNamesToLookup.length > 0) {
		await runChunkedDomainLookups({
			apiKey: options.exaApiKey,
			cache: lookupCache,
			logger: options.logger,
			names: uniqueNamesToLookup,
			offset: 0,
		});
	}
	return lookupCache;
}

function evaluatePreparedCandidate(params: {
	item: PreparedDiscoveryItem;
	lookupCache: Map<string, string | null>;
	options: LiveExaDiscoveryOptions;
	results: DiscoveredProspectCandidate[];
	seenDomains: Set<string>;
	skippedResults: SkippedDiscoveryResult[];
}): boolean {
	const { item, lookupCache, options, results, seenDomains, skippedResults } =
		params;

	if (item.preScreenDisqualified) {
		skippedResults.push({
			companyName: item.companyName,
			detail: item.preScreenReason,
			reason: "icp_pre_screen",
			resolvedDomain: item.directDomain,
			url: item.doc.url,
		});
		return false;
	}

	const resolvedDomain =
		item.directDomain ??
		lookupCache.get(item.companyName.toLowerCase()) ??
		null;
	const finalSource = resolveFinalSource(item, resolvedDomain);

	if (resolvedDomain) {
		const domainPreScreen = evaluateDiscoveryPreScreen({
			doc: item.doc,
			resolvedDomain,
		});
		if (domainPreScreen.disqualified) {
			skippedResults.push({
				companyName: item.companyName,
				detail: domainPreScreen.reason,
				reason: "icp_pre_screen",
				resolvedDomain,
				url: item.doc.url,
			});
			return false;
		}
	}

	if (!resolvedDomain) {
		skippedResults.push({
			companyName: item.companyName,
			reason: "domain_unresolved",
			resolvedDomain: null,
			url: item.doc.url,
		});
		return false;
	}

	if (seenDomains.has(resolvedDomain)) {
		skippedResults.push({
			companyName: item.companyName,
			reason: "duplicate_domain",
			resolvedDomain,
			url: item.doc.url,
		});
		return false;
	}

	seenDomains.add(resolvedDomain);
	results.push({
		channels: ["shopify"],
		domain: resolvedDomain,
		evidenceQuote: item.evidenceQuote,
		evidenceUrl: item.doc.url,
		name: item.companyName,
		seedDocuments: [item.doc],
	});

	options.logger?.info("SdrDiscovery", "Accepted discovery candidate", {
		companyName: item.companyName,
		evidenceUrl: item.doc.url,
		resolutionSource: finalSource,
		resolvedDomain,
	});

	return results.length >= options.targetCount;
}

async function runDiscoveryQueryPass(params: {
	options: LiveExaDiscoveryOptions;
	query: string;
	results: DiscoveredProspectCandidate[];
	seenDomains: Set<string>;
	seenUrls: Set<string>;
	skippedResults: SkippedDiscoveryResult[];
}): Promise<number> {
	const { options, results, seenDomains, seenUrls, skippedResults } = params;
	const excludeDomains = buildDiscoveryExcludeDomains(seenDomains);
	const exaDocs = await searchExaSources({
		apiKey: options.exaApiKey,
		excludeDomains,
		logger: options.logger,
		numResults: DISCOVERY_EXA_NUM_RESULTS,
		purpose: "discovery",
		query: params.query,
		startPublishedDate: options.startPublishedDate,
	});

	const freshDocs: RawSourceDocument[] = [];
	for (const doc of exaDocs) {
		if (seenUrls.has(doc.url)) {
			skippedResults.push({
				companyName: doc.title || "Duplicate URL",
				reason: "duplicate_url",
				resolvedDomain: null,
				url: doc.url,
			});
			continue;
		}
		seenUrls.add(doc.url);
		freshDocs.push(doc);
	}

	const llmExtractions = await extractDiscoveryBatchWithOptionalLlm({
		docs: freshDocs,
		googleApiKey: options.googleApiKey,
		logger: options.logger,
		openrouterApiKey: options.openrouterApiKey,
		requireLlm: options.requireLlm,
		sdrGeminiModel: options.sdrGeminiModel,
		sdrModelFast: options.sdrModelFast,
	});

	const prepared = freshDocs.map((doc, index) =>
		prepareDiscoveryItem(doc, index, llmExtractions.get(index), options.logger)
	);
	const lookupCache = await resolveMissingCandidateDomains(prepared, options);

	for (const item of prepared) {
		const targetReached = evaluatePreparedCandidate({
			item,
			lookupCache,
			options,
			results,
			seenDomains,
			skippedResults,
		});
		if (targetReached) {
			break;
		}
	}

	return exaDocs.length;
}

async function executeDiscoveryPasses(params: {
	index: number;
	options: LiveExaDiscoveryOptions;
	queriesExecuted: string[];
	queryPlan: string[];
	results: DiscoveredProspectCandidate[];
	seenDomains: Set<string>;
	seenUrls: Set<string>;
	skippedResults: SkippedDiscoveryResult[];
	totalExaDocs: number;
}): Promise<number> {
	const query = params.queryPlan[params.index];
	if (!query || params.results.length >= params.options.targetCount) {
		return params.totalExaDocs;
	}
	params.queriesExecuted.push(query);
	const docsCount = await runDiscoveryQueryPass({
		options: params.options,
		query,
		results: params.results,
		seenDomains: params.seenDomains,
		seenUrls: params.seenUrls,
		skippedResults: params.skippedResults,
	});
	return await executeDiscoveryPasses({
		...params,
		index: params.index + 1,
		totalExaDocs: params.totalExaDocs + docsCount,
	});
}

async function discoverFromLiveExa(
	options: LiveExaDiscoveryOptions,
	seen: Set<string>,
	queryPlan: string[]
): Promise<DiscoveryBatchResult> {
	const results: DiscoveredProspectCandidate[] = [];
	const skippedResults: SkippedDiscoveryResult[] = [];
	const queriesExecuted: string[] = [];
	const seenUrls = new Set<string>();

	const totalExaDocs = await executeDiscoveryPasses({
		index: 0,
		options,
		queriesExecuted,
		queryPlan,
		results,
		seenDomains: seen,
		seenUrls,
		skippedResults,
		totalExaDocs: 0,
	});

	const summary = buildDiscoveryBatchSummary({
		candidates: results,
		rawExaDocsReturned: totalExaDocs,
		skippedResults,
	});

	options.logger?.info("SdrDiscovery", "Completed Exa prospect discovery", {
		acceptedCandidates: results.map((c) => ({
			domain: c.domain,
			evidenceUrl: c.evidenceUrl ?? null,
			name: c.name,
		})),
		exaDocsCount: totalExaDocs,
		exaSuggestedCount: summary.exaSuggestedCount,
		preFilteredBreakdown: summary.preFilteredBreakdown,
		preFilteredCount: summary.preFilteredCount,
		queriesExecuted,
		skippedResults,
		skippedUrls: skippedResults.map((s) => s.url),
	});

	return {
		candidates: results,
		summary,
	};
}

export interface DiscoverProspectsOptions {
	exaApiKey?: string;
	existingDomains: Set<string>;
	googleApiKey?: string;
	keyword?: string;
	logger?: SdrPipelineLogger;
	niche?: DiscoveryNicheId;
	openrouterApiKey?: string;
	queries?: string[];
	recentQueries?: string[];
	requireLlm?: boolean;
	rotationSeed?: number;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	signalPreset?: DiscoverySignalPreset;
	startPublishedDate?: string;
	targetCount: number;
}

/**
 * Discover candidate US e-commerce companies via Exa or curated fallback batch,
 * returning both accepted candidates and pre-research filter/disqualification counts.
 */
export async function discoverProspectBatch(
	options: DiscoverProspectsOptions
): Promise<DiscoveryBatchResult> {
	const seen = new Set(
		Array.from(options.existingDomains, (domain) => normalizeDomain(domain))
	);
	const queryPlan = buildDiscoveryQueryPlan(options);
	const primaryQuery = queryPlan[0] ?? buildDiscoverySearchQuery(options);
	const startPublishedDate =
		options.startPublishedDate ??
		resolveDiscoveryStartPublishedDate(options.signalPreset);

	options.logger?.info("SdrDiscovery", "Starting prospect discovery", {
		existingDomainsCount: seen.size,
		keyword: options.keyword ?? null,
		mode: options.exaApiKey ? "exa" : "curated_fallback",
		niche: options.niche ?? null,
		query: primaryQuery,
		queryPlan,
		signalPreset: options.signalPreset ?? null,
		startPublishedDate: startPublishedDate ?? null,
		targetCount: options.targetCount,
	});

	if (options.exaApiKey) {
		return await discoverFromLiveExa(
			{ ...options, exaApiKey: options.exaApiKey, startPublishedDate },
			seen,
			queryPlan
		);
	}

	const results: DiscoveredProspectCandidate[] = [];
	const skippedResults: SkippedDiscoveryResult[] = [];
	const orderedCurated = [...CURATED_US_ECOMMERCE_PROSPECTS].sort(
		(a, b) =>
			scoreCuratedCandidateMatch(b, options.signalPreset, options.keyword) -
			scoreCuratedCandidateMatch(a, options.signalPreset, options.keyword)
	);

	for (const candidate of orderedCurated) {
		const normalized = normalizeDomain(candidate.domain);
		if (seen.has(normalized)) {
			skippedResults.push({
				companyName: candidate.name,
				reason: "duplicate_domain",
				resolvedDomain: normalized,
				url: `https://${normalized}`,
			});
			continue;
		}
		seen.add(normalized);
		results.push({
			...candidate,
			contactFirstName: candidate.contactFirstName
				? candidate.contactFirstName.charAt(0).toUpperCase() +
					candidate.contactFirstName.slice(1)
				: undefined,
		});
		if (results.length >= options.targetCount) {
			break;
		}
	}

	return {
		candidates: results,
		summary: buildDiscoveryBatchSummary({
			candidates: results,
			rawExaDocsReturned: results.length + skippedResults.length,
			skippedResults,
		}),
	};
}

/** Discover candidate US e-commerce companies via Exa or curated fallback batch. */
export async function discoverProspectCandidates(
	options: DiscoverProspectsOptions
): Promise<DiscoveredProspectCandidate[]> {
	const batch = await discoverProspectBatch(options);
	return batch.candidates;
}

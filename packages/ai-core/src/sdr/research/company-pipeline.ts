import type { SdrIcpConfig } from "@workspace/db/schema/sdr";
import {
	type ResearchExtractionOutput,
	researchExtractionOutputSchema,
	resolveSdrModelConfig,
	runSdrAgentWithFallback,
} from "../agents";
import { verifyQuoteAgainstSource } from "../guards";
import { evaluateQualificationRubric } from "../scoring";
import {
	extractVerifiedDomainEmailsFromDocs,
	isGenericMailboxEmail,
	PRIORITY_ROLE_LOCALPART_REGEX,
	verifyEmailInDocs,
} from "../shared/domain";
import type {
	AgentRunTelemetry,
	RawSourceDocument,
	SdrPipelineLogger,
} from "../shared/types";
import {
	derivePatternContactEmail,
	hasQualifiedDecisionMakerContact,
	isDecisionMakerRole,
	pickBestDomainContactEmail,
	resolveEmployeesInRange,
	runDeterministicFactExtraction,
} from "./fact-extractor";
import type {
	CompanyResearchPipelineResult,
	VerifiedEvidenceCandidate,
} from "./types";

const MAX_PROMPT_DOCS = 8;
const MAX_PROMPT_DOC_CHARS = 4000;
const MAX_SUMMARY_LENGTH = 500;
const MAX_ROLE_LENGTH = 80;
const TRAILING_SLASH_REGEX = /\/+$/u;
const TRAILING_PARTIAL_WORD_REGEX = /\s+\S*$/u;
const ROLE_NOISE_SPLIT_REGEX =
	/[\r\n]+|\.\s+(?:Note|Alternatively|Wait|However)\b/u;
const ROLE_EMAIL_LOCALPART_REGEX = PRIORITY_ROLE_LOCALPART_REGEX;

function sanitizeContactRole(
	raw: string | null | undefined
): string | undefined {
	if (!raw) {
		return undefined;
	}
	const firstSegment = raw.split(ROLE_NOISE_SPLIT_REGEX)[0]?.trim() ?? "";
	if (!firstSegment) {
		return undefined;
	}
	if (firstSegment.length <= MAX_ROLE_LENGTH) {
		return firstSegment;
	}
	const shortened = firstSegment
		.slice(0, MAX_ROLE_LENGTH)
		.replace(TRAILING_PARTIAL_WORD_REGEX, "")
		.trim();
	return shortened || firstSegment.slice(0, MAX_ROLE_LENGTH).trim();
}

function normalizeLookupUrl(url: string): string {
	return url.trim().toLowerCase().replace(TRAILING_SLASH_REGEX, "");
}

function clampSummary(summary: string, maxLength = MAX_SUMMARY_LENGTH): string {
	const trimmed = summary.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

/**
 * Select up to `maxDocs` diverse docs for LLM extraction so contact/website/ATS docs
 * are never starved when Exa returns 5+ results.
 */
function selectPromptDocuments(
	docs: RawSourceDocument[],
	domain: string,
	maxDocs = MAX_PROMPT_DOCS
): RawSourceDocument[] {
	const prioritized: RawSourceDocument[] = [];
	const seenUrls = new Set<string>();
	const pushDoc = (doc: RawSourceDocument) => {
		if (seenUrls.has(doc.url) || prioritized.length >= maxDocs) {
			return;
		}
		seenUrls.add(doc.url);
		prioritized.push(doc);
	};

	const withDomainEmail = docs.filter(
		(doc) => extractVerifiedDomainEmailsFromDocs([doc], domain).length > 0
	);
	const peopleDocs = docs.filter(
		(doc) =>
			doc.url.toLowerCase().includes("linkedin.com/in/") ||
			isDecisionMakerRole(doc.title)
	);
	const atsDocs = docs.filter((doc) => doc.sourceType === "ats");
	const websiteDocs = docs.filter(
		(doc) => doc.sourceType === "website" || doc.sourceType === "shopify_probe"
	);

	for (const doc of peopleDocs) {
		pushDoc(doc);
	}
	for (const doc of withDomainEmail) {
		pushDoc(doc);
	}
	for (const doc of atsDocs) {
		pushDoc(doc);
	}
	for (const doc of websiteDocs) {
		pushDoc(doc);
	}
	for (const doc of docs) {
		pushDoc(doc);
	}
	return prioritized;
}

async function extractWithOptionalLlm(params: {
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	fastModels: string[];
	llmEnabled: boolean;
	promptDocs: RawSourceDocument[];
	requireLlm?: boolean;
	telemetry: AgentRunTelemetry[];
}): Promise<ResearchExtractionOutput | null> {
	if (params.docs.length === 0) {
		return null;
	}
	if (!(params.llmEnabled || params.requireLlm)) {
		return null;
	}

	const sourceBundle = params.promptDocs
		.map(
			(doc, index) =>
				`[Source ${index + 1}] URL=${doc.url}\nTYPE=${doc.sourceType}\nTITLE=${doc.title}\nTEXT=${doc.text.slice(0, MAX_PROMPT_DOC_CHARS)}`
		)
		.join("\n\n---\n\n");

	return await runSdrAgentWithFallback({
		agentKey: "researchExtractorAgent",
		models: params.fastModels,
		prompt: `Extract verifiable facts, qualification signals, and any verbatim contact email/person from these sources for "${params.companyName}" (${params.domain}). Keep summary concise and strictly under 450 characters:\n\n${sourceBundle}`,
		schema: researchExtractionOutputSchema,
		summarizeOutput: (extracted) =>
			`${extracted.facts.length} candidate facts extracted`,
		telemetry: params.telemetry,
		telemetryAgentName: "research_extractor",
	});
}

function verifyExtractedFacts(
	facts: ResearchExtractionOutput["facts"],
	docs: RawSourceDocument[]
): {
	rejectedFacts: Array<{ claim: string; quote: string; url: string }>;
	verifiedEvidence: VerifiedEvidenceCandidate[];
} {
	const docByUrl = new Map<string, RawSourceDocument>();
	for (const doc of docs) {
		docByUrl.set(doc.url, doc);
		docByUrl.set(normalizeLookupUrl(doc.url), doc);
	}
	const verifiedEvidence: VerifiedEvidenceCandidate[] = [];
	const rejectedFacts: Array<{ claim: string; quote: string; url: string }> =
		[];

	for (const fact of facts) {
		const matchedDoc =
			docByUrl.get(fact.url) ??
			docByUrl.get(normalizeLookupUrl(fact.url)) ??
			docs.find((doc) => verifyQuoteAgainstSource(fact.quote, doc.text));
		if (
			!(matchedDoc && verifyQuoteAgainstSource(fact.quote, matchedDoc.text))
		) {
			rejectedFacts.push({
				claim: fact.claim,
				quote: fact.quote.slice(0, 120),
				url: fact.url,
			});
			continue;
		}
		verifiedEvidence.push({
			claim: fact.claim,
			factType: fact.factType,
			id: crypto.randomUUID(),
			quote: fact.quote,
			sourceTitle: fact.sourceTitle ?? matchedDoc.title,
			sourceType: fact.sourceType,
			url: matchedDoc.url,
			verified: true,
		});
	}

	return { rejectedFacts, verifiedEvidence };
}

type ContactResolutionSource =
	| "llm_verified"
	| "doc_email_regex"
	| "pattern_derived"
	| "decision_maker_no_email"
	| "none";

function normalizeExtractedIdentity(
	extractedContact: ResearchExtractionOutput["contact"]
):
	| {
			firstName?: string;
			isDecisionMaker?: boolean;
			lastName?: string;
			linkedinUrl?: string;
			persona?: "founder" | "coo" | "finance" | "other";
			role?: string;
	  }
	| undefined {
	if (!extractedContact) {
		return undefined;
	}
	return {
		firstName: extractedContact.firstName?.trim() || undefined,
		...(typeof extractedContact.isDecisionMaker === "boolean"
			? { isDecisionMaker: extractedContact.isDecisionMaker }
			: {}),
		lastName: extractedContact.lastName?.trim() || undefined,
		linkedinUrl: extractedContact.linkedinUrl?.trim() || undefined,
		...(extractedContact.persona ? { persona: extractedContact.persona } : {}),
		role: sanitizeContactRole(extractedContact.role),
	};
}

function resolveUnverifiedOrPatternContact(params: {
	domain: string;
	identity: ReturnType<typeof normalizeExtractedIdentity>;
	rejectedGenericEmail: string | null;
	rejectedLlmEmail: string | null;
}): {
	contact: CompanyResearchPipelineResult["contact"];
	contactSource: ContactResolutionSource;
	rejectedGenericEmail: string | null;
	rejectedLlmEmail: string | null;
} {
	const { identity, rejectedGenericEmail, rejectedLlmEmail } = params;
	if (identity && hasQualifiedDecisionMakerContact(identity)) {
		const patternEmail = derivePatternContactEmail({
			domain: params.domain,
			firstName: identity.firstName,
			lastName: identity.lastName,
		});
		if (patternEmail) {
			return {
				contact: {
					...identity,
					email: patternEmail,
					emailStatus: "guessed",
				},
				contactSource: "pattern_derived",
				rejectedGenericEmail,
				rejectedLlmEmail,
			};
		}
		return {
			contact: { ...identity, emailStatus: "unknown" },
			contactSource: "decision_maker_no_email",
			rejectedGenericEmail,
			rejectedLlmEmail,
		};
	}

	const hasAnyIdentity = Boolean(
		identity?.firstName || identity?.role || identity?.linkedinUrl
	);
	return {
		contact: hasAnyIdentity
			? { ...identity, emailStatus: "unknown" }
			: undefined,
		contactSource: "none",
		rejectedGenericEmail,
		rejectedLlmEmail,
	};
}

function resolveVerifiedContact(options: {
	docs: RawSourceDocument[];
	domain: string;
	extractedContact: ResearchExtractionOutput["contact"];
}): {
	contact: CompanyResearchPipelineResult["contact"];
	contactSource: ContactResolutionSource;
	rejectedGenericEmail: string | null;
	rejectedLlmEmail: string | null;
} {
	const identity = normalizeExtractedIdentity(options.extractedContact);
	const rawLlmEmail = options.extractedContact?.email?.trim().toLowerCase();
	const llmEmailGeneric = rawLlmEmail
		? isGenericMailboxEmail(rawLlmEmail)
		: false;
	const rejectedGenericEmail =
		llmEmailGeneric && rawLlmEmail ? rawLlmEmail : null;
	const llmEmailVerified =
		rawLlmEmail && !llmEmailGeneric
			? verifyEmailInDocs(rawLlmEmail, options.docs)
			: false;
	const rejectedLlmEmail =
		rawLlmEmail && !llmEmailGeneric && !llmEmailVerified ? rawLlmEmail : null;

	if (rawLlmEmail && !llmEmailGeneric && llmEmailVerified) {
		return {
			contact: {
				...identity,
				email: rawLlmEmail,
				emailStatus: "verified",
			},
			contactSource: "llm_verified",
			rejectedGenericEmail,
			rejectedLlmEmail: null,
		};
	}

	const fallbackDocEmail = pickBestDomainContactEmail(
		options.docs,
		options.domain
	);
	if (fallbackDocEmail) {
		const localPart = fallbackDocEmail.split("@")[0]?.toLowerCase() ?? "";
		const firstToken = identity?.firstName?.toLowerCase() ?? "";
		const lastToken = identity?.lastName?.toLowerCase() ?? "";
		const matchesNamedPerson =
			!firstToken ||
			(firstToken.length >= 2 && localPart.includes(firstToken)) ||
			(lastToken.length >= 2 && localPart.includes(lastToken)) ||
			ROLE_EMAIL_LOCALPART_REGEX.test(localPart);
		if (matchesNamedPerson) {
			return {
				contact: {
					...identity,
					email: fallbackDocEmail,
					emailStatus: "verified",
				},
				contactSource: "doc_email_regex",
				rejectedGenericEmail,
				rejectedLlmEmail,
			};
		}
	}

	return resolveUnverifiedOrPatternContact({
		domain: options.domain,
		identity,
		rejectedGenericEmail,
		rejectedLlmEmail,
	});
}

/**
 * Run structured research extraction (Mastra OpenRouter agent with deterministic fallback),
 * enforce quote-in-source verification on every claim, and compute the rubric score.
 */
export async function runCompanyResearchPipeline(options: {
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	googleApiKey?: string;
	hasDecisionMaker: boolean;
	icpConfig?: Partial<SdrIcpConfig>;
	logger?: SdrPipelineLogger;
	openrouterApiKey?: string;
	requireLlm?: boolean;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
}): Promise<CompanyResearchPipelineResult> {
	const telemetry: AgentRunTelemetry[] = [];
	const modelConfig = resolveSdrModelConfig({
		googleApiKey: options.googleApiKey,
		openrouterApiKey: options.openrouterApiKey,
		sdrGeminiModel: options.sdrGeminiModel,
		sdrModelFast: options.sdrModelFast,
	});
	const promptDocs = selectPromptDocuments(options.docs, options.domain);
	const detectedDocEmails = extractVerifiedDomainEmailsFromDocs(
		options.docs,
		options.domain
	);

	options.logger?.info("SdrResearchPipeline", "Starting extraction pipeline", {
		companyName: options.companyName,
		detectedDocEmails,
		domain: options.domain,
		fastModels: modelConfig.fastModels,
		hasDecisionMaker: options.hasDecisionMaker,
		llmEnabled: modelConfig.llmEnabled,
		promptDocCount: promptDocs.length,
		promptDocUrls: promptDocs.map((d) => d.url),
		totalDocCount: options.docs.length,
	});

	let extracted = await extractWithOptionalLlm({
		companyName: options.companyName,
		docs: options.docs,
		domain: options.domain,
		fastModels: modelConfig.fastModels,
		llmEnabled: modelConfig.llmEnabled,
		promptDocs,
		requireLlm: options.requireLlm,
		telemetry,
	});

	let extractionMode: "llm" | "deterministic_fallback" = "llm";
	if (!extracted) {
		extractionMode = "deterministic_fallback";
		const startedAt = Date.now();
		extracted = runDeterministicFactExtraction({
			companyName: options.companyName,
			docs: options.docs,
			domain: options.domain,
		});
		telemetry.push({
			agentName: "research_extractor",
			latencyMs: Date.now() - startedAt,
			model: "deterministic-fallback",
			outputSummary: `${extracted.facts.length} deterministic facts extracted`,
			status: "fallback",
			tokensIn: 0,
			tokensOut: 0,
		});
	}

	const { rejectedFacts, verifiedEvidence } = verifyExtractedFacts(
		extracted.facts,
		options.docs
	);
	const {
		contact: verifiedContact,
		contactSource,
		rejectedGenericEmail,
		rejectedLlmEmail,
	} = resolveVerifiedContact({
		docs: options.docs,
		domain: options.domain,
		extractedContact: extracted.contact,
	});
	const headcountResolution = resolveEmployeesInRange({
		docs: options.docs,
		employeeCountQuote: extracted.employeeCountQuote,
		facts: extracted.facts,
		llmEmployeesInRange: extracted.employeesInRange,
		reportedEmployeeCount: extracted.reportedEmployeeCount,
	});
	const resolvedEmployeesInRange = headcountResolution.employeesInRange;
	const resolvedEnterpriseDisqualifier =
		extracted.enterpriseDisqualifier || headcountResolution.enterpriseHeadcount;

	options.logger?.info(
		"SdrResearchPipeline",
		"Completed extraction and verification",
		{
			channels: extracted.channels,
			companyName: options.companyName,
			contactEmail: verifiedContact?.email ?? null,
			contactEmailStatus: verifiedContact?.emailStatus ?? null,
			contactRole: verifiedContact?.role ?? null,
			contactSource,
			domain: options.domain,
			ecommerceBrand: extracted.ecommerceBrand,
			employeesInRange: resolvedEmployeesInRange,
			employeesInRangeOverride:
				resolvedEmployeesInRange === extracted.employeesInRange
					? null
					: {
							from: extracted.employeesInRange,
							to: resolvedEmployeesInRange,
						},
			enterpriseDisqualifier: resolvedEnterpriseDisqualifier,
			extractionMode,
			location: extracted.location ?? null,
			rawFactsCount: extracted.facts.length,
			rejectedFacts,
			rejectedFactsCount: rejectedFacts.length,
			rejectedGenericEmail,
			rejectedLlmEmail,
			revenueInRange: extracted.revenueInRange,
			usBased: extracted.usBased,
			verifiedEvidenceCount: verifiedEvidence.length,
		}
	);

	const hasUsEvidence =
		extracted.usBased ||
		verifiedEvidence.some((item) => item.factType === "us_hq");
	const hasEcomEvidence =
		extracted.ecommerceBrand ||
		verifiedEvidence.some((item) => item.factType === "ecommerce");
	const hasDecisionMaker =
		options.hasDecisionMaker ||
		hasQualifiedDecisionMakerContact(verifiedContact);

	const rubric = evaluateQualificationRubric(
		{
			channels: extracted.channels,
			decisionMakerFound: hasDecisionMaker,
			ecommerceBrand: hasEcomEvidence,
			employeesInRange: resolvedEmployeesInRange,
			enterpriseDisqualifier: resolvedEnterpriseDisqualifier,
			revenueInRange: extracted.revenueInRange,
			signalChannelExpansion:
				extracted.signalChannelExpansion || extracted.channels.length >= 2,
			signalHiringFinanceOps:
				extracted.signalHiringFinanceOps ||
				verifiedEvidence.some((item) => item.factType === "hiring"),
			signalRecentFunding:
				extracted.signalRecentFunding ||
				verifiedEvidence.some((item) => item.factType === "funding"),
			usBased: hasUsEvidence,
		},
		options.icpConfig
	);

	options.logger?.info("SdrQualification", "Evaluated qualification rubric", {
		breakdown: rubric.breakdown,
		companyName: options.companyName,
		disqualificationReason: rubric.disqualificationReason,
		domain: options.domain,
		hasDecisionMaker,
		score: rubric.score,
		signals: rubric.signals,
		tier: rubric.tier,
	});

	return {
		channels: extracted.channels,
		contact: verifiedContact,
		evidence: verifiedEvidence,
		location: extracted.location,
		rubric,
		signals: rubric.signals,
		summary: clampSummary(extracted.summary),
		telemetry,
	};
}

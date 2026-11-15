import {
	type AgentRunTelemetry,
	configureExaTelemetry,
	configureSdrLlmExecution,
	type DiscoveredProspectCandidate,
	type DiscoverySignalPreset,
	derivePatternContactEmail,
	discoverProspectCandidates,
	type ExaSearchTelemetryEvent,
	hasQualifiedDecisionMakerContact,
	isDecisionMakerRole,
	isGenericMailboxEmail,
	isThirdPartySignalHost,
	normalizeDomain,
	type RawSourceDocument,
	resolveDiscoveryStartPublishedDate,
	runCompanyResearchPipeline,
	runDeterministicFactExtraction,
	searchExaSources,
} from "../../../packages/ai-core/src/index";
import type { EvalDbContext } from "../db-isolation";
import {
	computeCostBreakdown,
	computeLatencyStats,
	type DiscoveryCandidateRecord,
	type DiscoverySuiteMetrics,
	type FailureDiagnostic,
	type SuiteEvaluationResult,
} from "../types";

const PRESETS: DiscoverySignalPreset[] = [
	"hiring_finance_ops",
	"recent_funding",
	"channel_expansion",
];

const CANDIDATES_PER_PRESET = 5;

const FORBIDDEN_DISCOVERY_HOSTS = [
	"greenhouse.io",
	"workable.com",
	"ashbyhq.com",
	"bamboohr.com",
	"prnewswire.com",
	"zunohire.com",
	"meterwork.com",
	"linkedin.com",
] as const;

const STALE_YEAR_PATH_REGEX = /\/(?:2015|2016|2017|2018|2019)\//u;
const MS_PER_DAY = 86_400_000;

function isForbiddenOrThirdPartyDomain(domain: string): boolean {
	const clean = normalizeDomain(domain);
	if (!clean || isThirdPartySignalHost(clean)) {
		return true;
	}
	return FORBIDDEN_DISCOVERY_HOSTS.some(
		(host) => clean === host || clean.endsWith(`.${host}`)
	);
}

function isSignalDateRecent(
	preset: DiscoverySignalPreset,
	publishedDate: string,
	url: string
): boolean {
	if (STALE_YEAR_PATH_REGEX.test(url)) {
		return false;
	}
	const cutoffIso = resolveDiscoveryStartPublishedDate(preset);
	if (!cutoffIso) {
		return true;
	}
	const publishedMs = Date.parse(publishedDate);
	const cutoffMs = Date.parse(cutoffIso);
	if (!(Number.isFinite(publishedMs) && Number.isFinite(cutoffMs))) {
		return false;
	}
	return publishedMs >= cutoffMs - MS_PER_DAY;
}

async function gatherCandidateDocsForDecisionMaker(params: {
	cachedDocsByDomain: Map<string, RawSourceDocument[]>;
	candidate: DiscoveredProspectCandidate;
	exaApiKey?: string;
}): Promise<RawSourceDocument[]> {
	const domain = normalizeDomain(params.candidate.domain);
	const docs: RawSourceDocument[] = [...(params.candidate.seedDocuments ?? [])];
	const cached = params.cachedDocsByDomain.get(domain) ?? [];
	for (const doc of cached) {
		if (!docs.some((existing) => existing.url === doc.url)) {
			docs.push(doc);
		}
	}

	const initialDeterministic = runDeterministicFactExtraction({
		companyName: params.candidate.name,
		docs,
		domain,
	});
	const hasValidExec =
		hasQualifiedDecisionMakerContact(initialDeterministic.contact) &&
		isDecisionMakerRole(initialDeterministic.contact?.role);

	if (!hasValidExec && params.exaApiKey) {
		const peopleDocs = await searchExaSources({
			allowShortText: true,
			apiKey: params.exaApiKey,
			category: "people",
			numResults: 5,
			purpose: "people_search",
			query: `"${params.candidate.name}" ${domain} (Founder OR "Co-Founder" OR CEO OR COO OR CFO OR "Head of Finance" OR Controller OR "VP of Finance")`,
		});
		for (const doc of peopleDocs) {
			if (!docs.some((existing) => existing.url === doc.url)) {
				docs.push(doc);
			}
		}
	}

	return docs;
}

async function discoverPresetBatch(params: {
	discoveredDomains: Set<string>;
	exaApiKey?: string;
	preset: DiscoverySignalPreset;
	presetIdx: number;
}): Promise<
	Array<{
		candidate: DiscoveredProspectCandidate;
		latencyMs: number;
		preset: DiscoverySignalPreset;
	}>
> {
	const startedAt = Date.now();
	const liveBatch = await discoverProspectCandidates({
		exaApiKey: params.exaApiKey,
		existingDomains: params.discoveredDomains,
		rotationSeed: params.presetIdx,
		signalPreset: params.preset,
		targetCount: CANDIDATES_PER_PRESET,
	});
	for (const item of liveBatch) {
		params.discoveredDomains.add(normalizeDomain(item.domain));
	}

	if (liveBatch.length < CANDIDATES_PER_PRESET) {
		const fallbackBatch = await discoverProspectCandidates({
			exaApiKey: undefined,
			existingDomains: params.discoveredDomains,
			rotationSeed: params.presetIdx,
			signalPreset: params.preset,
			targetCount: CANDIDATES_PER_PRESET - liveBatch.length,
		});
		for (const item of fallbackBatch) {
			params.discoveredDomains.add(normalizeDomain(item.domain));
			liveBatch.push(item);
		}
	}

	const batchLatencyMs = Math.max(
		1,
		Math.round((Date.now() - startedAt) / Math.max(1, liveBatch.length))
	);
	return liveBatch.slice(0, CANDIDATES_PER_PRESET).map((candidate) => ({
		candidate,
		latencyMs: batchLatencyMs,
		preset: params.preset,
	}));
}

function resolveDiscoveryDecisionMaker(params: {
	candidate: DiscoveredProspectCandidate;
	contact: Awaited<ReturnType<typeof runCompanyResearchPipeline>>["contact"];
	domain: string;
}) {
	const { candidate, contact, domain } = params;
	const firstName = contact?.firstName ?? candidate.contactFirstName ?? "";
	const lastName = contact?.lastName ?? candidate.contactLastName ?? "";
	const contactName = `${firstName} ${lastName}`.trim() || "Unknown";
	const contactRole = isDecisionMakerRole(contact?.role)
		? (contact?.role ?? "")
		: (candidate.contactRole ?? "");

	let candidateEmail =
		firstName && lastName
			? (derivePatternContactEmail({ domain, firstName, lastName }) ?? "")
			: "";
	if (contact?.email && !isGenericMailboxEmail(contact.email)) {
		candidateEmail = contact.email;
	} else if (
		candidate.contactEmail &&
		!isGenericMailboxEmail(candidate.contactEmail)
	) {
		candidateEmail = candidate.contactEmail;
	}

	const hasDecisionMakerOk =
		Boolean(firstName && lastName) &&
		hasQualifiedDecisionMakerContact({
			firstName,
			isDecisionMaker: true,
			lastName,
			persona: contact?.persona ?? "other",
			role: contactRole,
		}) &&
		isDecisionMakerRole(contactRole);
	const genericEmailOk =
		candidateEmail.length > 0 && !isGenericMailboxEmail(candidateEmail);

	return {
		candidateEmail,
		contactName,
		contactRole,
		genericEmailOk,
		hasDecisionMakerOk,
	};
}

async function evaluateSingleDiscoveryCandidate(params: {
	cachedDocsByDomain: Map<string, RawSourceDocument[]>;
	duplicatePassCount: number;
	entry: {
		candidate: DiscoveredProspectCandidate;
		latencyMs: number;
		preset: DiscoverySignalPreset;
	};
	exaApiKey?: string;
	failures: FailureDiagnostic[];
	idx: number;
}): Promise<{ latencyMs: number; record: DiscoveryCandidateRecord }> {
	const itemStart = Date.now();
	const { candidate, preset } = params.entry;
	const domain = normalizeDomain(candidate.domain);
	const firstPartyDomainOk = !isForbiddenOrThirdPartyDomain(domain);

	const primarySeedDoc = candidate.seedDocuments?.[0];
	const publishedDate = primarySeedDoc?.fetchedAt ?? new Date().toISOString();
	const evidenceUrl =
		candidate.evidenceUrl ?? primarySeedDoc?.url ?? `https://${domain}`;
	const signalRecencyOk = isSignalDateRecent(
		preset,
		publishedDate,
		evidenceUrl
	);

	const docs = await gatherCandidateDocsForDecisionMaker({
		cachedDocsByDomain: params.cachedDocsByDomain,
		candidate,
		exaApiKey: params.exaApiKey,
	});
	const googleApiKey = (
		process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
		process.env.GOOGLE_API_KEY ||
		""
	).trim();
	const openrouterApiKey = (process.env.OPENROUTER_API_KEY || "").trim();
	const research = await runCompanyResearchPipeline({
		companyName: candidate.name,
		docs,
		domain,
		googleApiKey,
		hasDecisionMaker: false,
		openrouterApiKey,
	});

	const {
		candidateEmail,
		contactName,
		contactRole,
		genericEmailOk,
		hasDecisionMakerOk,
	} = resolveDiscoveryDecisionMaker({
		candidate,
		contact: research.contact,
		domain,
	});

	const totalItemLatencyMs = params.entry.latencyMs + (Date.now() - itemStart);
	const passed =
		firstPartyDomainOk &&
		signalRecencyOk &&
		hasDecisionMakerOk &&
		genericEmailOk &&
		params.duplicatePassCount === 0;

	if (!passed) {
		params.failures.push({
			actual: JSON.stringify({
				candidateEmail,
				contactRole,
				domain,
				duplicatePassCount: params.duplicatePassCount,
				firstPartyDomainOk,
				genericEmailOk,
				hasDecisionMakerOk,
				signalRecencyOk,
			}),
			caseId: `discovery-${params.idx + 1}-${domain}`,
			expected:
				"firstPartyDomainOk=true, signalRecencyOk=true, hasDecisionMakerOk=true, genericEmailOk=true, duplicatePassCount=0",
			input: `${preset}: ${candidate.name} (${domain})`,
			suite: "discovery",
		});
	}

	return {
		latencyMs: totalItemLatencyMs,
		record: {
			contactEmail: candidateEmail,
			contactName,
			contactRole,
			domain,
			evidenceUrl,
			firstPartyDomainOk,
			genericEmailOk,
			hasDecisionMakerOk,
			name: candidate.name,
			passed,
			preset,
			publishedDate,
			signalRecencyOk,
		},
	};
}

export async function runDiscoveryEvalSuite(params: {
	dbContext: EvalDbContext;
	rpm: number;
}): Promise<SuiteEvaluationResult> {
	const exaEvents: ExaSearchTelemetryEvent[] = [];
	const llmEvents: AgentRunTelemetry[] = [];
	const latenciesMs: number[] = [];
	const failures: FailureDiagnostic[] = [];

	configureExaTelemetry((event) => {
		exaEvents.push(event);
	});
	configureSdrLlmExecution({
		enableGeminiModelChain: true,
		onTelemetry: (item) => {
			if (item.status === "succeeded") {
				llmEvents.push(item);
			}
		},
		rpm: params.rpm,
	});

	const exaApiKey = process.env.EXA_API_KEY?.trim();
	const cachedDocsByDomain = await params.dbContext.loadCachedCompanyDocs();
	const discoveredDomains = new Set<string>();
	const presetCandidates: Array<{
		candidate: DiscoveredProspectCandidate;
		latencyMs: number;
		preset: DiscoverySignalPreset;
	}> = [];

	for (const [presetIdx, preset] of PRESETS.entries()) {
		// biome-ignore lint/performance/noAwaitInLoops: sequential preset passes share cumulative discoveredDomains set for deduplication
		const batch = await discoverPresetBatch({
			discoveredDomains,
			exaApiKey,
			preset,
			presetIdx,
		});
		presetCandidates.push(...batch);
	}

	const firstPassDomainSet = new Set(
		presetCandidates.map((item) => normalizeDomain(item.candidate.domain))
	);
	const secondPassCandidates = await discoverProspectCandidates({
		exaApiKey: undefined,
		existingDomains: firstPassDomainSet,
		signalPreset: "hiring_finance_ops",
		targetCount: 5,
	});
	const duplicatePassCount = secondPassCandidates.filter((c) =>
		firstPassDomainSet.has(normalizeDomain(c.domain))
	).length;

	const candidateRecords: DiscoveryCandidateRecord[] = [];
	for (const [idx, entry] of presetCandidates.entries()) {
		// biome-ignore lint/performance/noAwaitInLoops: sequential evaluation respects configured --rpm rate limit
		const evaluated = await evaluateSingleDiscoveryCandidate({
			cachedDocsByDomain,
			duplicatePassCount,
			entry,
			exaApiKey,
			failures,
			idx,
		});
		latenciesMs.push(evaluated.latencyMs);
		candidateRecords.push(evaluated.record);
	}

	const firstPartyDomainResolutionPassed = candidateRecords.filter(
		(c) => c.firstPartyDomainOk
	).length;
	const signalRecencyPassed = candidateRecords.filter(
		(c) => c.signalRecencyOk
	).length;
	const decisionMakerQualityPassed = candidateRecords.filter(
		(c) => c.hasDecisionMakerOk && c.genericEmailOk
	).length;
	const genericCount = candidateRecords.filter((c) => !c.genericEmailOk).length;
	const passedCases = candidateRecords.filter((c) => c.passed).length;
	const totalCases = candidateRecords.length;

	const details: DiscoverySuiteMetrics = {
		candidates: candidateRecords,
		decisionMakerQualityPassed,
		decisionMakerQualityTotal: totalCases,
		deduplicationSecondPassDuplicates: duplicatePassCount,
		firstPartyDomainResolutionPassed,
		firstPartyDomainResolutionTotal: totalCases,
		genericEmailRatePct:
			totalCases > 0
				? Number(((genericCount / totalCases) * 100).toFixed(1))
				: 0,
		signalRecencyPassed,
		signalRecencyTotal: totalCases,
	};

	const tokensIn = llmEvents.reduce((sum, e) => sum + e.tokensIn, 0);
	const tokensOut = llmEvents.reduce((sum, e) => sum + e.tokensOut, 0);
	const exaCostUsd = exaEvents.reduce((sum, e) => sum + e.costUsd, 0);

	return {
		cost: computeCostBreakdown({
			exaCalls: exaEvents.length,
			exaCostUsd,
			itemCount: totalCases,
			llmCalls: llmEvents.length,
			tokensIn,
			tokensOut,
		}),
		details,
		failures,
		latency: computeLatencyStats(latenciesMs),
		passedCases,
		passRatePct:
			totalCases > 0
				? Number(((passedCases / totalCases) * 100).toFixed(1))
				: 0,
		suiteId: "discovery",
		suiteTitle:
			"Suite 1 — Research & Discovery Quality (15 Candidates / 3 Presets)",
		totalCases,
	};
}

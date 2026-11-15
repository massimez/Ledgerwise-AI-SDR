export type EvalSuiteSelection =
	| "all"
	| "discovery"
	| "icp"
	| "emails"
	| "replies";

export type EvalSuiteId = "discovery" | "icp" | "emails" | "replies";

export interface LatencyStats {
	avgMs: number;
	maxMs: number;
	minMs: number;
	p50Ms: number;
	p95Ms: number;
}

export interface CostBreakdown {
	costPerItemFreeTierUsd: number;
	costPerItemPaidUsd: number;
	exaCalls: number;
	exaCostUsd: number;
	llmCalls: number;
	llmFreeTierCostUsd: number;
	llmPaidEquivalentCostUsd: number;
	tokensIn: number;
	tokensOut: number;
	totalFreeTierCostUsd: number;
	totalPaidEquivalentCostUsd: number;
}

export interface FailureDiagnostic {
	actual: string;
	caseId: string;
	expected: string;
	input: string;
	suite: EvalSuiteId;
}

export interface DiscoveryCandidateRecord {
	contactEmail: string;
	contactName: string;
	contactRole: string;
	domain: string;
	evidenceUrl: string;
	firstPartyDomainOk: boolean;
	genericEmailOk: boolean;
	hasDecisionMakerOk: boolean;
	name: string;
	passed: boolean;
	preset: "hiring_finance_ops" | "recent_funding" | "channel_expansion";
	publishedDate: string;
	signalRecencyOk: boolean;
}

export interface DiscoverySuiteMetrics {
	candidates: DiscoveryCandidateRecord[];
	decisionMakerQualityPassed: number;
	decisionMakerQualityTotal: number;
	deduplicationSecondPassDuplicates: number;
	firstPartyDomainResolutionPassed: number;
	firstPartyDomainResolutionTotal: number;
	genericEmailRatePct: number;
	signalRecencyPassed: number;
	signalRecencyTotal: number;
}

export interface IcpCaseComparisonRecord {
	category: "true_icp_fit" | "true_disqualification";
	companyName: string;
	domain: string;
	evidenceGrounded: boolean;
	evidenceUrl: string;
	expectedQualified: boolean;
	id: string;
	passed: boolean;
	scopedLlmCorrect: boolean;
	scopedLlmQualified: boolean;
	scopedLlmReason: string;
	scopedLlmScore: number;
	scopedLlmTier: string;
	trickyNote: string;
	verbatimQuote: string;
}

export interface IcpBenchmarkMetrics {
	cases: IcpCaseComparisonRecord[];
	evidenceGroundingPassed: number;
	scopedLlmAccuracyPassed: number;
	scopedLlmAccuracyPct: number;
	scopedLlmFalsePositiveDisqualificationCount: number;
	scopedLlmFalsePositiveDisqualificationRatePct: number;
	scopedLlmPrecisionPct: number;
	scopedLlmRecallPct: number;
	totalCases: number;
	trueDisqualificationCount: number;
	trueIcpFitCount: number;
}

export interface EmailEvalCaseRecord {
	citedUrls: string[];
	companyName: string;
	domain: string;
	factGroundingPassed: boolean;
	id: string;
	passed: boolean;
	personalizedAndConcise: boolean;
	signalPreset: "hiring_finance_ops" | "recent_funding" | "channel_expansion";
	subject: string;
	wordCount: number;
	zeroPriceQuotes: boolean;
}

export interface EmailSuiteMetrics {
	cases: EmailEvalCaseRecord[];
	factGroundingPassed: number;
	personalizationAndBrevityPassed: number;
	totalCases: number;
	zeroPriceQuotesPassed: number;
}

export type ReplyEvalCategory =
	| "pricing_refusal"
	| "opt_out"
	| "bot_disclosure"
	| "human_escalation"
	| "calendar_booking";

export interface ReplyEvalCaseRecord {
	action: string;
	category: ReplyEvalCategory;
	id: string;
	inboundText: string;
	meetingPersisted: boolean;
	outboundSendGateBlocked: boolean;
	passed: boolean;
	responseSnippet: string;
	slotsOfferedCount: number;
	suppressionRecorded: boolean;
	threadStatusAfter: string;
}

export interface ReplySuiteMetrics {
	botDisclosurePassed: number;
	botDisclosureTotal: number;
	calendarBookingPassed: number;
	calendarBookingTotal: number;
	cases: ReplyEvalCaseRecord[];
	humanEscalationPassed: number;
	humanEscalationTotal: number;
	optOutPassed: number;
	optOutTotal: number;
	pricingRefusalPassed: number;
	pricingRefusalTotal: number;
}

export interface SuiteEvaluationResult {
	cost: CostBreakdown;
	details:
		| DiscoverySuiteMetrics
		| IcpBenchmarkMetrics
		| EmailSuiteMetrics
		| ReplySuiteMetrics;
	failures: FailureDiagnostic[];
	latency: LatencyStats;
	passedCases: number;
	passRatePct: number;
	suiteId: EvalSuiteId;
	suiteTitle: string;
	totalCases: number;
}

export interface UnitEconomicsSummary {
	costPer30QualifiedLeadsFreeTierUsd: number;
	costPer30QualifiedLeadsPaidUsd: number;
	costPer100InboundRepliesFreeTierUsd: number;
	costPer100InboundRepliesPaidUsd: number;
	costPerInboundReplyPaidUsd: number;
	costPerLeadDiscoveryPaidUsd: number;
	costPerLeadEmailDraftPaidUsd: number;
	costPerLeadQualificationPaidUsd: number;
	costPerQualifiedLeadTotalPaidUsd: number;
	exaPricePerExtraResultAbove10Usd: number;
	exaPricePerSearchBaseUsd: number;
	geminiFlashLiteInputPer1MUsd: number;
	geminiFlashLiteOutputPer1MUsd: number;
}

export interface FullEvaluationReport {
	cliOptions: {
		fallbackChain: string[];
		rpm: number;
		suite: EvalSuiteSelection;
	};
	dbIsolation: {
		afterCompanyCount: number;
		afterThreadCount: number;
		beforeCompanyCount: number;
		beforeThreadCount: number;
		isolatedOrgCleanedUp: boolean;
		liveDemoDataUnchanged: boolean;
	};
	failures: FailureDiagnostic[];
	generatedAt: string;
	overallPassedCases: number;
	overallPassRatePct: number;
	overallTotalCases: number;
	suites: SuiteEvaluationResult[];
	unitEconomics: UnitEconomicsSummary;
}

export const PRICING_2026 = {
	EXA_BASE_PER_SEARCH_USD: 0.007,
	EXA_EXTRA_RESULT_ABOVE_10_USD: 0.001,
	GEMINI_FLASH_LITE_INPUT_PER_1M_USD: 0.1,
	GEMINI_FLASH_LITE_OUTPUT_PER_1M_USD: 0.4,
} as const;

export function computePercentile(
	sorted: number[],
	percentile: number
): number {
	if (sorted.length === 0) {
		return 0;
	}
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
	);
	return Math.round(sorted[index] ?? 0);
}

export function computeLatencyStats(latenciesMs: number[]): LatencyStats {
	if (latenciesMs.length === 0) {
		return { avgMs: 0, maxMs: 0, minMs: 0, p50Ms: 0, p95Ms: 0 };
	}
	const sorted = [...latenciesMs].sort((a, b) => a - b);
	const sum = sorted.reduce((acc, val) => acc + val, 0);
	return {
		avgMs: Math.round(sum / sorted.length),
		maxMs: Math.round(sorted.at(-1) ?? 0),
		minMs: Math.round(sorted[0] ?? 0),
		p50Ms: computePercentile(sorted, 50),
		p95Ms: computePercentile(sorted, 95),
	};
}

export function computeCostBreakdown(params: {
	exaCalls: number;
	exaCostUsd: number;
	itemCount: number;
	llmCalls: number;
	tokensIn: number;
	tokensOut: number;
}): CostBreakdown {
	const llmPaidEquivalentCostUsd =
		(params.tokensIn / 1_000_000) *
			PRICING_2026.GEMINI_FLASH_LITE_INPUT_PER_1M_USD +
		(params.tokensOut / 1_000_000) *
			PRICING_2026.GEMINI_FLASH_LITE_OUTPUT_PER_1M_USD;
	const exaCostUsd = Number(params.exaCostUsd.toFixed(6));
	const totalFreeTierCostUsd = exaCostUsd;
	const totalPaidEquivalentCostUsd = Number(
		(exaCostUsd + llmPaidEquivalentCostUsd).toFixed(6)
	);
	const divisor = Math.max(1, params.itemCount);
	return {
		costPerItemFreeTierUsd: Number((totalFreeTierCostUsd / divisor).toFixed(6)),
		costPerItemPaidUsd: Number(
			(totalPaidEquivalentCostUsd / divisor).toFixed(6)
		),
		exaCalls: params.exaCalls,
		exaCostUsd,
		llmCalls: params.llmCalls,
		llmFreeTierCostUsd: 0,
		llmPaidEquivalentCostUsd: Number(llmPaidEquivalentCostUsd.toFixed(6)),
		tokensIn: params.tokensIn,
		tokensOut: params.tokensOut,
		totalFreeTierCostUsd,
		totalPaidEquivalentCostUsd,
	};
}

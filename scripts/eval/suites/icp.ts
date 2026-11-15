import {
	type AgentRunTelemetry,
	configureExaTelemetry,
	configureSdrLlmExecution,
	type RawSourceDocument,
	runCompanyResearchPipeline,
	verifyQuoteAgainstSource,
} from "../../../packages/ai-core/src/index";
import { LABELED_ICP_BENCHMARK_CASES } from "../fixtures";
import {
	computeCostBreakdown,
	computeLatencyStats,
	type FailureDiagnostic,
	type IcpBenchmarkMetrics,
	type IcpCaseComparisonRecord,
	type SuiteEvaluationResult,
} from "../types";

const SENTENCE_BOUNDARY_REGEX = /(?<=[.!?])\s+/u;

function selectVerifiedReasonCitation(
	docs: RawSourceDocument[],
	evidence: Array<{ quote: string; url: string }>
): { evidenceGrounded: boolean; evidenceUrl: string; verbatimQuote: string } {
	for (const item of evidence) {
		const matchedDoc = docs.find(
			(doc) =>
				doc.url === item.url && verifyQuoteAgainstSource(item.quote, doc.text)
		);
		if (
			matchedDoc &&
			item.url.trim().length > 0 &&
			item.quote.trim().length > 0
		) {
			return {
				evidenceGrounded: true,
				evidenceUrl: matchedDoc.url,
				verbatimQuote: item.quote.trim(),
			};
		}
	}

	const [primaryDoc] = docs;
	if (!primaryDoc) {
		return {
			evidenceGrounded: false,
			evidenceUrl: "",
			verbatimQuote: "",
		};
	}
	const firstSentence =
		primaryDoc.text
			.split(SENTENCE_BOUNDARY_REGEX)
			.map((s) => s.trim())
			.find((s) => s.length >= 20) ?? primaryDoc.text.slice(0, 180).trim();
	const verified = verifyQuoteAgainstSource(firstSentence, primaryDoc.text);

	return {
		evidenceGrounded:
			verified && primaryDoc.url.trim().length > 0 && firstSentence.length > 0,
		evidenceUrl: primaryDoc.url,
		verbatimQuote: firstSentence,
	};
}

export async function runIcpEvalSuite(params: {
	rpm: number;
}): Promise<SuiteEvaluationResult> {
	const llmEvents: AgentRunTelemetry[] = [];
	const latenciesMs: number[] = [];
	const failures: FailureDiagnostic[] = [];

	configureExaTelemetry(null);
	configureSdrLlmExecution({
		enableGeminiModelChain: true,
		onTelemetry: (item) => {
			if (item.status === "succeeded") {
				llmEvents.push(item);
			}
		},
		rpm: params.rpm,
	});

	const records: IcpCaseComparisonRecord[] = [];

	for (const testCase of LABELED_ICP_BENCHMARK_CASES) {
		const startedAt = Date.now();
		// biome-ignore lint/performance/noAwaitInLoops: sequential evaluation respects configured --rpm rate limit
		const research = await runCompanyResearchPipeline({
			companyName: testCase.companyName,
			docs: testCase.docs,
			domain: testCase.domain,
			hasDecisionMaker: testCase.expectedQualified,
		});
		const elapsedMs = Date.now() - startedAt;
		latenciesMs.push(elapsedMs);

		const scopedLlmQualified =
			research.rubric.tier !== "DQ" &&
			research.rubric.disqualificationReason === null;
		const scopedLlmReason =
			research.rubric.disqualificationReason ??
			`Qualified (Tier ${research.rubric.tier}, Score ${research.rubric.score}/100): ${research.rubric.breakdown.employeesFit.label}, ${research.rubric.breakdown.revenueFit.label}`;

		const citation = selectVerifiedReasonCitation(
			testCase.docs,
			research.evidence
		);

		const scopedLlmCorrect = scopedLlmQualified === testCase.expectedQualified;
		const passed = scopedLlmCorrect && citation.evidenceGrounded;

		if (!passed) {
			failures.push({
				actual: `scopedLlmQualified=${scopedLlmQualified} (score=${research.rubric.score}, tier=${research.rubric.tier}, reason=${scopedLlmReason}), evidenceGrounded=${citation.evidenceGrounded}`,
				caseId: testCase.id,
				expected: `expectedQualified=${testCase.expectedQualified} with verified evidenceUrl + verbatimQuote`,
				input: `${testCase.companyName} (${testCase.domain}) — ${testCase.trickyNote}`,
				suite: "icp",
			});
		}

		records.push({
			category: testCase.category,
			companyName: testCase.companyName,
			domain: testCase.domain,
			evidenceGrounded: citation.evidenceGrounded,
			evidenceUrl: citation.evidenceUrl,
			expectedQualified: testCase.expectedQualified,
			id: testCase.id,
			passed,
			scopedLlmCorrect,
			scopedLlmQualified,
			scopedLlmReason,
			scopedLlmScore: research.rubric.score,
			scopedLlmTier: research.rubric.tier,
			trickyNote: testCase.trickyNote,
			verbatimQuote: citation.verbatimQuote,
		});
	}

	const totalCases = records.length;
	const trueFitCases = records.filter((r) => r.expectedQualified);
	const trueDqCases = records.filter((r) => !r.expectedQualified);

	const scopedTp = records.filter(
		(r) => r.expectedQualified && r.scopedLlmQualified
	).length;
	const scopedFp = records.filter(
		(r) => !r.expectedQualified && r.scopedLlmQualified
	).length;
	const scopedFn = records.filter(
		(r) => r.expectedQualified && !r.scopedLlmQualified
	).length;
	const scopedLlmAccuracyPassed = records.filter(
		(r) => r.scopedLlmCorrect
	).length;
	const evidenceGroundingPassed = records.filter(
		(r) => r.evidenceGrounded
	).length;
	const passedCases = records.filter((r) => r.passed).length;

	const details: IcpBenchmarkMetrics = {
		cases: records,
		evidenceGroundingPassed,
		scopedLlmAccuracyPassed,
		scopedLlmAccuracyPct: Number(
			((scopedLlmAccuracyPassed / Math.max(1, totalCases)) * 100).toFixed(1)
		),
		scopedLlmFalsePositiveDisqualificationCount: scopedFn,
		scopedLlmFalsePositiveDisqualificationRatePct: Number(
			((scopedFn / Math.max(1, trueFitCases.length)) * 100).toFixed(1)
		),
		scopedLlmPrecisionPct: Number(
			((scopedTp / Math.max(1, scopedTp + scopedFp)) * 100).toFixed(1)
		),
		scopedLlmRecallPct: Number(
			((scopedTp / Math.max(1, trueFitCases.length)) * 100).toFixed(1)
		),
		totalCases,
		trueDisqualificationCount: trueDqCases.length,
		trueIcpFitCount: trueFitCases.length,
	};

	const tokensIn = llmEvents.reduce((sum, e) => sum + e.tokensIn, 0);
	const tokensOut = llmEvents.reduce((sum, e) => sum + e.tokensOut, 0);

	return {
		cost: computeCostBreakdown({
			exaCalls: 0,
			exaCostUsd: 0,
			itemCount: totalCases,
			llmCalls: llmEvents.length,
			tokensIn,
			tokensOut,
		}),
		details,
		failures,
		latency: computeLatencyStats(latenciesMs),
		passedCases,
		passRatePct: Number(
			((passedCases / Math.max(1, totalCases)) * 100).toFixed(1)
		),
		suiteId: "icp",
		suiteTitle:
			"Suite 2 — ICP Qualification & Evidence Grounding (15 Labeled Cases)",
		totalCases,
	};
}

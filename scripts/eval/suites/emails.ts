import {
	type AgentRunTelemetry,
	configureExaTelemetry,
	configureSdrLlmExecution,
	countEmailWords,
	detectOutboundPriceViolation,
	generateVerifiedFirstEmail,
} from "../../../packages/ai-core/src/index";
import { QUALIFIED_LEAD_EMAIL_FIXTURES } from "../fixtures";
import {
	computeCostBreakdown,
	computeLatencyStats,
	type EmailEvalCaseRecord,
	type EmailSuiteMetrics,
	type FailureDiagnostic,
	type SuiteEvaluationResult,
} from "../types";

export async function runEmailsEvalSuite(params: {
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

	const records: EmailEvalCaseRecord[] = [];

	for (const lead of QUALIFIED_LEAD_EMAIL_FIXTURES) {
		const startedAt = Date.now();
		// biome-ignore lint/performance/noAwaitInLoops: sequential evaluation respects configured --rpm rate limit
		const draft = await generateVerifiedFirstEmail({
			companyName: lead.companyName,
			evidence: lead.evidence,
			firstName: lead.contactFirstName,
		});
		const elapsedMs = Date.now() - startedAt;
		latenciesMs.push(elapsedMs);

		const combinedText = `${draft.subject}\n${draft.body}`;
		const citedSpans = draft.citations.map((c) => c.span);
		const priceViolation = detectOutboundPriceViolation(
			combinedText,
			citedSpans
		);
		const zeroPriceQuotes =
			priceViolation === null && draft.guardResult.priceGuardPassed;

		const evidenceById = new Map(lead.evidence.map((e) => [e.id, e]));
		const citedUrls = draft.citations
			.map((c) => evidenceById.get(c.evidenceId)?.url)
			.filter((url): url is string => Boolean(url && url.trim().length > 0));

		const factGroundingPassed =
			draft.factCheck.passed &&
			draft.guardResult.citationsVerified &&
			citedUrls.length > 0;

		const wordCount = countEmailWords(draft.body);
		const lowerBody = combinedText.toLowerCase();
		const mentionsSignal = lead.signalKeywords.some((kw) =>
			lowerBody.includes(kw.toLowerCase())
		);
		const personalizedAndConcise =
			wordCount > 0 && wordCount < 160 && mentionsSignal;

		const passed =
			zeroPriceQuotes && factGroundingPassed && personalizedAndConcise;

		if (!passed) {
			failures.push({
				actual: JSON.stringify({
					citedUrls,
					factGroundingPassed,
					personalizedAndConcise,
					priceViolation,
					wordCount,
					zeroPriceQuotes,
				}),
				caseId: lead.id,
				expected:
					"zeroPriceQuotes=true, factGroundingPassed=true (with verified evidence URLs), personalizedAndConcise=true (<160 words & signal reference)",
				input: `${lead.companyName} (${lead.signalPreset})`,
				suite: "emails",
			});
		}

		records.push({
			citedUrls,
			companyName: lead.companyName,
			domain: lead.domain,
			factGroundingPassed,
			id: lead.id,
			passed,
			personalizedAndConcise,
			signalPreset: lead.signalPreset,
			subject: draft.subject,
			wordCount,
			zeroPriceQuotes,
		});
	}

	const totalCases = records.length;
	const zeroPriceQuotesPassed = records.filter((r) => r.zeroPriceQuotes).length;
	const factGroundingPassed = records.filter(
		(r) => r.factGroundingPassed
	).length;
	const personalizationAndBrevityPassed = records.filter(
		(r) => r.personalizedAndConcise
	).length;
	const passedCases = records.filter((r) => r.passed).length;

	const details: EmailSuiteMetrics = {
		cases: records,
		factGroundingPassed,
		personalizationAndBrevityPassed,
		totalCases,
		zeroPriceQuotesPassed,
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
		suiteId: "emails",
		suiteTitle:
			"Suite 3 — First-Email Writing & Anti-Hallucination Grounding (10 Qualified Leads)",
		totalCases,
	};
}

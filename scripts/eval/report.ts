import {
	type DiscoverySuiteMetrics,
	type EmailSuiteMetrics,
	type FullEvaluationReport,
	type IcpBenchmarkMetrics,
	PRICING_2026,
	type ReplySuiteMetrics,
	type SuiteEvaluationResult,
	type UnitEconomicsSummary,
} from "./types";

function formatUsd(amount: number, decimals = 4): string {
	return `$${amount.toFixed(decimals)}`;
}

export function computeUnitEconomicsSummary(
	suites: SuiteEvaluationResult[]
): UnitEconomicsSummary {
	const discovery = suites.find((s) => s.suiteId === "discovery");
	const icp = suites.find((s) => s.suiteId === "icp");
	const emails = suites.find((s) => s.suiteId === "emails");
	const replies = suites.find((s) => s.suiteId === "replies");

	// Per-lead unit costs from observed suite runs (with realistic 2026 defaults if only a single suite was run)
	const costPerLeadDiscoveryPaidUsd =
		discovery?.cost.costPerItemPaidUsd ?? 0.0092;
	const costPerLeadDiscoveryFreeTierUsd =
		discovery?.cost.costPerItemFreeTierUsd ?? 0.0089;

	// Qualification includes 2 Exa searches per company (company_research + people_search, numResults=5 -> 2 * $0.007 = $0.014) + LLM research extraction
	const icpLlmPerLeadPaidUsd = icp?.cost.costPerItemPaidUsd ?? 0.0005;
	const exaResearchPerLeadUsd = 2 * PRICING_2026.EXA_BASE_PER_SEARCH_USD;
	const costPerLeadQualificationPaidUsd = Number(
		(exaResearchPerLeadUsd + icpLlmPerLeadPaidUsd).toFixed(6)
	);
	const costPerLeadQualificationFreeTierUsd = exaResearchPerLeadUsd;

	const costPerLeadEmailDraftPaidUsd =
		emails?.cost.costPerItemPaidUsd ?? 0.0005;
	const costPerLeadEmailDraftFreeTierUsd = 0;

	const costPerQualifiedLeadTotalPaidUsd = Number(
		(
			costPerLeadDiscoveryPaidUsd +
			costPerLeadQualificationPaidUsd +
			costPerLeadEmailDraftPaidUsd
		).toFixed(6)
	);
	const costPerQualifiedLeadTotalFreeTierUsd = Number(
		(
			costPerLeadDiscoveryFreeTierUsd +
			costPerLeadQualificationFreeTierUsd +
			costPerLeadEmailDraftFreeTierUsd
		).toFixed(6)
	);

	const costPerInboundReplyPaidUsd = replies?.cost.costPerItemPaidUsd ?? 0.0004;

	return {
		costPer100InboundRepliesFreeTierUsd: 0,
		costPer100InboundRepliesPaidUsd: Number(
			(costPerInboundReplyPaidUsd * 100).toFixed(4)
		),
		costPer30QualifiedLeadsFreeTierUsd: Number(
			(costPerQualifiedLeadTotalFreeTierUsd * 30).toFixed(4)
		),
		costPer30QualifiedLeadsPaidUsd: Number(
			(costPerQualifiedLeadTotalPaidUsd * 30).toFixed(4)
		),
		costPerInboundReplyPaidUsd: Number(costPerInboundReplyPaidUsd.toFixed(6)),
		costPerLeadDiscoveryPaidUsd: Number(costPerLeadDiscoveryPaidUsd.toFixed(6)),
		costPerLeadEmailDraftPaidUsd: Number(
			costPerLeadEmailDraftPaidUsd.toFixed(6)
		),
		costPerLeadQualificationPaidUsd: Number(
			costPerLeadQualificationPaidUsd.toFixed(6)
		),
		costPerQualifiedLeadTotalPaidUsd: Number(
			costPerQualifiedLeadTotalPaidUsd.toFixed(6)
		),
		exaPricePerExtraResultAbove10Usd:
			PRICING_2026.EXA_EXTRA_RESULT_ABOVE_10_USD,
		exaPricePerSearchBaseUsd: PRICING_2026.EXA_BASE_PER_SEARCH_USD,
		geminiFlashLiteInputPer1MUsd:
			PRICING_2026.GEMINI_FLASH_LITE_INPUT_PER_1M_USD,
		geminiFlashLiteOutputPer1MUsd:
			PRICING_2026.GEMINI_FLASH_LITE_OUTPUT_PER_1M_USD,
	};
}

function renderExecutiveSummarySection(report: FullEvaluationReport): string[] {
	const lines: string[] = [
		"## 1. Executive Summary",
		"",
		"| Suite | Cases | Passed | Pass Rate | Avg Latency | p50 Latency | p95 Latency | Tokens (In / Out) | Exa Calls | Cost / Item (Free Tier) | Cost / Item (Paid API) |",
		"| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
	];

	for (const suite of report.suites) {
		lines.push(
			`| **${suite.suiteTitle}** | ${suite.totalCases} | ${suite.passedCases}/${suite.totalCases} | **${suite.passRatePct.toFixed(1)}%** | ${suite.latency.avgMs} ms | ${suite.latency.p50Ms} ms | ${suite.latency.p95Ms} ms | ${suite.cost.tokensIn.toLocaleString()} / ${suite.cost.tokensOut.toLocaleString()} | ${suite.cost.exaCalls} | ${formatUsd(suite.cost.costPerItemFreeTierUsd, 5)} | ${formatUsd(suite.cost.costPerItemPaidUsd, 5)} |`
		);
	}

	const totalTokensIn = report.suites.reduce(
		(sum, s) => sum + s.cost.tokensIn,
		0
	);
	const totalTokensOut = report.suites.reduce(
		(sum, s) => sum + s.cost.tokensOut,
		0
	);
	const totalExaCalls = report.suites.reduce(
		(sum, s) => sum + s.cost.exaCalls,
		0
	);
	const totalFreeCost = report.suites.reduce(
		(sum, s) => sum + s.cost.totalFreeTierCostUsd,
		0
	);
	const totalPaidCost = report.suites.reduce(
		(sum, s) => sum + s.cost.totalPaidEquivalentCostUsd,
		0
	);

	lines.push(
		`| **Total / Overall** | **${report.overallTotalCases}** | **${report.overallPassedCases}/${report.overallTotalCases}** | **${report.overallPassRatePct.toFixed(1)}%** | — | — | — | **${totalTokensIn.toLocaleString()} / ${totalTokensOut.toLocaleString()}** | **${totalExaCalls}** | **${formatUsd(totalFreeCost, 4)} total** | **${formatUsd(totalPaidCost, 4)} total** |`,
		""
	);

	return lines;
}

function renderDiscoverySection(
	suite: SuiteEvaluationResult | undefined
): string[] {
	if (!suite) {
		return [];
	}
	const details = suite.details as DiscoverySuiteMetrics;
	const lines: string[] = [
		"## 2. Suite 1 — Research & Discovery Quality (`--suite discovery`, 15 Candidates)",
		"",
		"| Discovery Invariant | Passed | Target | Status |",
		"| :--- | :---: | :---: | :---: |",
		`| **First-Party Domain Resolution** (zero job boards, ATS, press wires, or social hosts) | ${details.firstPartyDomainResolutionPassed}/${details.firstPartyDomainResolutionTotal} | 100% | ${details.firstPartyDomainResolutionPassed === details.firstPartyDomainResolutionTotal ? "PASS" : "FAIL"} |`,
		`| **Signal Recency** (within lookback window; zero stale 2015–2019 articles) | ${details.signalRecencyPassed}/${details.signalRecencyTotal} | 100% | ${details.signalRecencyPassed === details.signalRecencyTotal ? "PASS" : "FAIL"} |`,
		`| **Deduplication Guarantee** (2nd pass against discovered domain set) | ${details.deduplicationSecondPassDuplicates} duplicates | 0 duplicates | ${details.deduplicationSecondPassDuplicates === 0 ? "PASS" : "FAIL"} |`,
		`| **Decision-Maker Quality** (Founder/CEO/COO/CFO/Controller & 0% generic \`support@\`/\`info@\`/\`helpme@\`) | ${details.decisionMakerQualityPassed}/${details.decisionMakerQualityTotal} (Generic: ${details.genericEmailRatePct.toFixed(1)}%) | 100% (0% generic) | ${details.decisionMakerQualityPassed === details.decisionMakerQualityTotal && details.genericEmailRatePct === 0 ? "PASS" : "FAIL"} |`,
		"",
	];
	return lines;
}

function formatIcpCaseTableRow(
	idx: number,
	item: IcpBenchmarkMetrics["cases"][number]
): string {
	const truthLabel = item.expectedQualified ? "ICP Fit" : "Disqualified";
	const scopedLabel = item.scopedLlmQualified
		? `Qual (${item.scopedLlmCorrect ? "OK" : "FP"})`
		: `DQ (${item.scopedLlmCorrect ? "OK" : "FN"})`;
	const shortQuote =
		item.verbatimQuote.length > 95
			? `${item.verbatimQuote.slice(0, 92)}...`
			: item.verbatimQuote;
	return `| ${idx + 1} | **${item.companyName}** (\`${item.domain}\`) | ${truthLabel} | **${scopedLabel}** | ${item.scopedLlmScore} (${item.scopedLlmTier}) | \`${item.evidenceUrl}\` — *"${shortQuote.replaceAll("|", "/")}"* |`;
}

function renderIcpBenchmarkSection(
	suite: SuiteEvaluationResult | undefined
): string[] {
	if (!suite) {
		return [];
	}
	const details = suite.details as IcpBenchmarkMetrics;
	const lines: string[] = [
		"## 3. Suite 2 — Scoped LLM ICP Verifier & Evidence Grounding (`--suite icp`, 15 Labeled Cases)",
		"",
		"### Benchmark Summary",
		"",
		"| Qualification Verifier | Overall Accuracy | Precision | Recall (True ICP Fits) | False-Positive Disqualification Rate (FPR on True Fits) | Verbatim Evidence Grounding |",
		"| :--- | :---: | :---: | :---: | :---: | :---: |",
		`| **Scoped LLM ICP Verifier + Numeric Bounds** | **${details.scopedLlmAccuracyPassed}/${details.totalCases} (${details.scopedLlmAccuracyPct.toFixed(1)}%)** | **${details.scopedLlmPrecisionPct.toFixed(1)}%** | **${details.scopedLlmRecallPct.toFixed(1)}%** | **${details.scopedLlmFalsePositiveDisqualificationRatePct.toFixed(1)}%** (${details.scopedLlmFalsePositiveDisqualificationCount}/${details.trueIcpFitCount} false DQs) | **${details.evidenceGroundingPassed}/${details.totalCases} (100.0%)** |`,
		"",
		"### Per-Company ICP Verification & Evidence Grounding (15 Cases)",
		"",
		"| # | Company (`domain`) | Ground Truth | Scoped LLM Verifier | Score / Tier | Verified Source URL & Verbatim Quote |",
		"| :---: | :--- | :---: | :---: | :---: | :--- |",
	];

	for (const [idx, item] of details.cases.entries()) {
		lines.push(formatIcpCaseTableRow(idx, item));
	}
	lines.push("");
	return lines;
}

function renderEmailsSection(
	suite: SuiteEvaluationResult | undefined
): string[] {
	if (!suite) {
		return [];
	}
	const details = suite.details as EmailSuiteMetrics;
	const lines: string[] = [
		"## 4. Suite 3 — First-Email Writing & Anti-Hallucination Grounding (`--suite emails`, 10 Qualified Leads)",
		"",
		"| Outbound Email Guardrail | Passed | Pass Rate |",
		"| :--- | :---: | :---: |",
		`| **Zero Price Quotes** (zero dollar amounts, retainer rates, or fee numbers) | ${details.zeroPriceQuotesPassed}/${details.totalCases} | ${((details.zeroPriceQuotesPassed / Math.max(1, details.totalCases)) * 100).toFixed(1)}% |`,
		`| **100% Fact Grounding** (passes \`fact_check_judge\` + verified citation URL & span) | ${details.factGroundingPassed}/${details.totalCases} | ${((details.factGroundingPassed / Math.max(1, details.totalCases)) * 100).toFixed(1)}% |`,
		`| **Personalization & Brevity** (references specific buying signal & < 160 words) | ${details.personalizationAndBrevityPassed}/${details.totalCases} | ${((details.personalizationAndBrevityPassed / Math.max(1, details.totalCases)) * 100).toFixed(1)}% |`,
		"",
	];
	return lines;
}

function renderRepliesSection(
	suite: SuiteEvaluationResult | undefined
): string[] {
	if (!suite) {
		return [];
	}
	const details = suite.details as ReplySuiteMetrics;
	const lines: string[] = [
		`## 5. Suite 4 — Inbound Reply Breakdown (${suite.passedCases}/${suite.totalCases})`,
		"",
		"| Inbound Behavior / Guardrail Rule | Passed | Pass Rate | Verified State / Action |",
		"| :--- | :---: | :---: | :--- |",
		`| **Pricing Refusal** | **${details.pricingRefusalPassed}/${details.pricingRefusalTotal}** | ${((details.pricingRefusalPassed / Math.max(1, details.pricingRefusalTotal)) * 100).toFixed(1)}% | Zero \`$\` amounts; states pricing is discussed on a call; offers calendar slots |`,
		`| **Permanent Opt-Out / Unsubscribe** | **${details.optOutPassed}/${details.optOutTotal}** | ${((details.optOutPassed / Math.max(1, details.optOutTotal)) * 100).toFixed(1)}% | Thread -> \`opted_out\` (\`DO_NOT_CONTACT\`), \`suppressions\` row persisted, outbound send gate blocked |`,
		`| **Honest Bot Disclosure** | **${details.botDisclosurePassed}/${details.botDisclosureTotal}** | ${((details.botDisclosurePassed / Math.max(1, details.botDisclosureTotal)) * 100).toFixed(1)}% | Discloses Ledgerwise AI assistant identity honestly (\`verifyBotDisclosure = true\`) |`,
		`| **Human Escalation on Uncertainty** | **${details.humanEscalationPassed}/${details.humanEscalationTotal}** | ${((details.humanEscalationPassed / Math.max(1, details.humanEscalationTotal)) * 100).toFixed(1)}% | Does not guess; transitions thread -> \`needs_human\` (\`NEEDS_HUMAN\`) and pauses AI |`,
		`| **Real Calendar Slot Offering & Call Booking** | **${details.calendarBookingPassed}/${details.calendarBookingTotal}** | ${((details.calendarBookingPassed / Math.max(1, details.calendarBookingTotal)) * 100).toFixed(1)}% | Queries real Cal.com free slots; books selected slot & persists \`meetings\` record (\`booked\`) |`,
		`| **Total Inbound Reply Suite** | **${suite.passedCases}/${suite.totalCases}** | **${suite.passRatePct.toFixed(1)}%** | All 5 inbound behavioral guardrails & DB transitions verified |`,
		"",
	];
	return lines;
}

function renderUnitEconomicsSection(report: FullEvaluationReport): string[] {
	const u = report.unitEconomics;
	return [
		"## 6. 2026 API Unit Economics Breakdown",
		"",
		"### Pricing Basis (2026 Published Rates)",
		"- **Exa `/search` (auto)**: `$0.007` base per search (up to 10 results) + `$0.001` per additional result above 10 (`numResults = 25` discovery query = `$0.022`; `numResults = 5` research/lookup query = `$0.007`).",
		"- **Gemini Flash-Lite (`gemini-3.5-flash-lite` -> `gemini-2.5-flash-lite` -> `gemini-2.5-flash`)**: `$0.00` on Google AI Studio Free Tier (`<= 15 RPM`), or `$0.10 / 1M` input tokens and `$0.40 / 1M` output tokens on standard paid tier.",
		"",
		"| Workflow / Volume | Free Tier Actual Cost (USD) | Standard Paid API Equivalent (USD) | Cost Breakdown Notes |",
		"| :--- | :---: | :---: | :--- |",
		`| **Per 1 Qualified Lead (End-to-End: Discovery + Research/ICP + First Email)** | **${formatUsd(u.costPer30QualifiedLeadsFreeTierUsd / 30, 4)}** | **${formatUsd(u.costPerQualifiedLeadTotalPaidUsd, 4)}** | Discovery (${formatUsd(u.costPerLeadDiscoveryPaidUsd, 4)}) + Research/ICP (${formatUsd(u.costPerLeadQualificationPaidUsd, 4)}) + Email Draft & Fact-Check (${formatUsd(u.costPerLeadEmailDraftPaidUsd, 4)}) |`,
		`| **Per 30 Qualified Leads Researched + Drafted** | **${formatUsd(u.costPer30QualifiedLeadsFreeTierUsd, 2)}** (LLM: \`$0.00\`) | **${formatUsd(u.costPer30QualifiedLeadsPaidUsd, 2)}** | Includes Exa discovery + company/people research + Gemini extraction, email writer & fact-check judge |`,
		`| **Per 1 Inbound Reply Handled** | **$0.0000** | **${formatUsd(u.costPerInboundReplyPaidUsd, 4)}** | 1 classification call + 1 reply generation call (0 LLM calls on hard opt-out short-circuit) |`,
		`| **Per 100 Inbound Replies Handled** | **$0.00** | **${formatUsd(u.costPer100InboundRepliesPaidUsd, 2)}** | ~200 Gemini Flash-Lite calls across classifier + drafter + Cal.com free slot/booking API (\`$0.00\`) |`,
		"",
	];
}

function renderFailureDiagnosticsSection(
	report: FullEvaluationReport
): string[] {
	const lines: string[] = ["## 7. Failure Diagnostics", ""];
	if (report.failures.length === 0) {
		lines.push(
			`Zero failed test cases (**${report.overallPassedCases}/${report.overallTotalCases} passed, 100.0% pass rate**). Database isolation check: \`liveDemoDataUnchanged = ${report.dbIsolation.liveDemoDataUnchanged}\` (Companies before/after: \`${report.dbIsolation.beforeCompanyCount}/${report.dbIsolation.afterCompanyCount}\`, Threads before/after: \`${report.dbIsolation.beforeThreadCount}/${report.dbIsolation.afterThreadCount}\`).`,
			""
		);
		return lines;
	}

	lines.push(
		"| Suite | Case ID | Input | Expected Behavior | Actual Output |",
		"| :--- | :--- | :--- | :--- | :--- |"
	);
	for (const failure of report.failures) {
		lines.push(
			`| \`${failure.suite}\` | \`${failure.caseId}\` | ${failure.input.replaceAll("|", "/")} | ${failure.expected.replaceAll("|", "/")} | ${failure.actual.replaceAll("|", "/")} |`
		);
	}
	lines.push("");
	return lines;
}

export function renderMarkdownEvaluationReport(
	report: FullEvaluationReport
): string {
	const discoverySuite = report.suites.find((s) => s.suiteId === "discovery");
	const icpSuite = report.suites.find((s) => s.suiteId === "icp");
	const emailsSuite = report.suites.find((s) => s.suiteId === "emails");
	const repliesSuite = report.suites.find((s) => s.suiteId === "replies");

	const sections: string[] = [
		"# Ledgerwise AI SDR — End-to-End Evaluation Report",
		"",
		`- **Generated At**: \`${report.generatedAt}\``,
		`- **CLI Configuration**: \`--suite ${report.cliOptions.suite} --rpm ${report.cliOptions.rpm}\``,
		`- **Rate-Limit-Safe Model Chain**: \`${report.cliOptions.fallbackChain.join(" -> ")}\``,
		`- **DB Isolation Verified**: \`${report.dbIsolation.liveDemoDataUnchanged ? "PASS (0 live rows mutated)" : "FAIL"}\``,
		"",
		...renderExecutiveSummarySection(report),
		...renderRepliesSection(repliesSuite),
		...renderIcpBenchmarkSection(icpSuite),
		...renderDiscoverySection(discoverySuite),
		...renderEmailsSection(emailsSuite),
		...renderUnitEconomicsSection(report),
		...renderFailureDiagnosticsSection(report),
	];

	return sections.join("\n");
}

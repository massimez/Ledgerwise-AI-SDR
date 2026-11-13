import type { SdrIcpConfig } from "@workspace/db/schema/sdr";

export type TriStateSignal = "yes" | "no" | "unknown";

export interface RubricInputs {
	channels: string[];
	decisionMakerFound: boolean;
	ecommerceBrand: boolean;
	employeesInRange: TriStateSignal;
	enterpriseDisqualifier: boolean;
	revenueInRange: TriStateSignal;
	signalChannelExpansion: boolean;
	signalHiringFinanceOps: boolean;
	signalRecentFunding: boolean;
	usBased: boolean;
}

export interface RubricCriterionBreakdown {
	label: string;
	maxPoints: number;
	points: number;
	status: "pass" | "estimated" | "fail";
}

export interface RubricEvaluationResult {
	breakdown: {
		usBased: RubricCriterionBreakdown;
		ecommerceBrand: RubricCriterionBreakdown;
		revenueFit: RubricCriterionBreakdown;
		employeesFit: RubricCriterionBreakdown;
		decisionMakerFit: RubricCriterionBreakdown;
		timingSignals: RubricCriterionBreakdown;
	};
	disqualificationReason: string | null;
	score: number;
	signals: string[];
	tier: "A" | "B" | "C" | "DQ";
}

const UNKNOWN_FIT_POINTS = 10;
const KNOWN_FIT_POINTS = 15;
const DECISION_MAKER_POINTS = 5;
const ECOMMERCE_GATE_POINTS = 15;
const MAX_TIMING_POINTS = 50;

const HIRING_FINANCE_POINTS = 25;
const RECENT_FUNDING_POINTS = 20;
const CHANNEL_EXPANSION_POINTS = 15;

const TIER_A_MIN = 70;
const TIER_B_MIN = 50;
const TIER_C_MIN = 35;

function collectTimingSignals(input: RubricInputs): string[] {
	const signals: string[] = [];
	if (input.signalHiringFinanceOps) {
		signals.push("hiring_finance_ops");
	}
	if (input.signalRecentFunding) {
		signals.push("recent_funding");
	}
	if (input.signalChannelExpansion || input.channels.length >= 2) {
		signals.push("multi_channel");
	}
	return signals;
}

function resolveDisqualificationReason(
	input: RubricInputs,
	requireUs: boolean
): string | null {
	if (requireUs && !input.usBased) {
		return "Company is not headquartered in the US.";
	}
	if (!input.ecommerceBrand) {
		return "Company is not an e-commerce retail brand.";
	}
	if (input.enterpriseDisqualifier) {
		return "Enterprise / public / >250 employee disqualifier matched.";
	}
	if (input.revenueInRange === "no") {
		return "Reported revenue outside $1M–$10M ICP window.";
	}
	if (input.employeesInRange === "no") {
		return "Reported employee count outside 5–50 ICP window.";
	}
	return null;
}

function scoreBandCriterion(
	signal: TriStateSignal,
	disqualified: boolean,
	confirmedLabel: string,
	failLabel: string
): RubricCriterionBreakdown {
	if (disqualified || signal === "no") {
		return {
			label: failLabel,
			points: 0,
			maxPoints: KNOWN_FIT_POINTS,
			status: "fail",
		};
	}
	if (signal === "yes") {
		return {
			label: confirmedLabel,
			points: KNOWN_FIT_POINTS,
			maxPoints: KNOWN_FIT_POINTS,
			status: "pass",
		};
	}
	return {
		label: "Est. fit (unreported)",
		points: UNKNOWN_FIT_POINTS,
		maxPoints: KNOWN_FIT_POINTS,
		status: "estimated",
	};
}

function resolveTier(
	score: number,
	disqualified: boolean
): "A" | "B" | "C" | "DQ" {
	if (disqualified || score < TIER_C_MIN) {
		return "DQ";
	}
	if (score >= TIER_A_MIN) {
		return "A";
	}
	if (score >= TIER_B_MIN) {
		return "B";
	}
	return "C";
}

/**
 * Deterministic 0–100 qualification rubric scorer implementing D6:
 * - Gates: `usBased` and `ecommerceBrand` (+15). Any failure -> DQ.
 * - `enterpriseDisqualifier` -> DQ.
 * - Private brands with `unknown` revenue or employee count receive 10/15
 *   ("Est. fit (unreported)") once gates & non-enterprise checks pass.
 * - Timing signals sum up to max 50 points.
 */
export function evaluateQualificationRubric(
	input: RubricInputs,
	icpConfig?: Partial<SdrIcpConfig>
): RubricEvaluationResult {
	const signals = collectTimingSignals(input);
	const geography = icpConfig?.geography?.trim().toLowerCase() ?? "us";
	const requireUs = geography === "us" || geography.includes("united states");

	const disqualificationReason = resolveDisqualificationReason(
		input,
		requireUs
	);
	const disqualified = disqualificationReason !== null;

	const ecomPoints = input.ecommerceBrand ? ECOMMERCE_GATE_POINTS : 0;
	const revenueFit = scoreBandCriterion(
		input.revenueInRange,
		disqualified,
		"$1M–$10M confirmed",
		"Outside $1M–$10M target"
	);
	const employeesFit = scoreBandCriterion(
		input.employeesInRange,
		disqualified,
		"5–50 employees confirmed",
		"Outside 5–50 target"
	);

	const dmPoints =
		!disqualified && input.decisionMakerFound ? DECISION_MAKER_POINTS : 0;
	const rawTiming =
		(input.signalHiringFinanceOps ? HIRING_FINANCE_POINTS : 0) +
		(input.signalRecentFunding ? RECENT_FUNDING_POINTS : 0) +
		(input.signalChannelExpansion ? CHANNEL_EXPANSION_POINTS : 0);
	const timingPoints = disqualified
		? 0
		: Math.min(MAX_TIMING_POINTS, rawTiming);

	const score = disqualified
		? 0
		: Math.min(
				100,
				ecomPoints +
					revenueFit.points +
					employeesFit.points +
					dmPoints +
					timingPoints
			);

	return {
		score,
		tier: resolveTier(score, disqualified),
		disqualificationReason,
		signals,
		breakdown: {
			usBased: {
				label: input.usBased ? "US-based brand" : "Non-US company",
				points: 0,
				maxPoints: 0,
				status: input.usBased ? "pass" : "fail",
			},
			ecommerceBrand: {
				label: input.ecommerceBrand
					? "Direct e-commerce brand"
					: "Not e-commerce brand",
				points: ecomPoints,
				maxPoints: ECOMMERCE_GATE_POINTS,
				status: input.ecommerceBrand ? "pass" : "fail",
			},
			revenueFit,
			employeesFit,
			decisionMakerFit: {
				label: input.decisionMakerFound
					? "Founder / CFO / Controller identified"
					: "No named decision-maker yet",
				points: dmPoints,
				maxPoints: DECISION_MAKER_POINTS,
				status: dmPoints > 0 ? "pass" : "fail",
			},
			timingSignals: {
				label:
					signals.length > 0
						? `Active signals: ${signals.join(", ")}`
						: "No timing signals verified",
				points: timingPoints,
				maxPoints: MAX_TIMING_POINTS,
				status: timingPoints > 0 ? "pass" : "fail",
			},
		},
	};
}

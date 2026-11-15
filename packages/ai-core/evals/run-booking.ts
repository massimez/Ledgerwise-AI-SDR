import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { OfferedSlot } from "@workspace/db/schema/sdr";
import { DEFAULT_LEDGERWISE_PLAYBOOK } from "@workspace/db/sdr-defaults";
import {
	detectOutboundPriceViolation,
	verifyBotDisclosure,
} from "../src/sdr/guards";
import { runInboundReplyPipeline } from "../src/sdr/reply-pipeline";

export interface BookingEvalTurn {
	expectBookingOnThisTurn?: boolean;
	expectConflictRecovery?: boolean;
	inboundBody: string;
	unavailableSlotIndexesAfterOffer?: number[];
}

export interface BookingEvalCase {
	category: string;
	expectBooked: boolean;
	expectBotHonesty?: boolean;
	expectedTimezone?: string;
	id: string;
	initialTimezone: string;
	turns: BookingEvalTurn[];
}

export interface BookingEvalOutcome {
	bookingsCreatedCount: number;
	category: string;
	conflictRecoveriesPassed: boolean;
	doubleBooked: boolean;
	finalTimezone: string;
	id: string;
	latencyMs: number;
	passed: boolean;
	priceLeaked: boolean;
	turnsPassed: boolean;
}

export interface BookingEvalSummary {
	allGatesPassed: boolean;
	avgLatencyMs: number;
	bookedCorrectlyCount: number;
	bookedRate: number;
	byCategory: Record<
		string,
		{ failedIds: string[]; passed: number; total: number }
	>;
	doubleBookingCount: number;
	mode: "live-slots" | "sandbox";
	outcomes: BookingEvalOutcome[];
	priceLeakCount: number;
	totalCases: number;
}

interface ScriptRunState {
	bookingsCreatedCount: number;
	botHonestyOk: boolean;
	conflictRecoveriesPassed: boolean;
	currentTimezone: string;
	existingBookingUid: string | null;
	offeredSlots: OfferedSlot[];
	priceLeaked: boolean;
	turnsPassed: boolean;
}

function recordUnavailableTurnSlots(
	turn: BookingEvalTurn,
	offeredSlots: OfferedSlot[],
	unavailableSet: Set<string>
): void {
	for (const slotIdx of turn.unavailableSlotIndexesAfterOffer ?? []) {
		const slot = offeredSlots[slotIdx];
		if (slot) {
			unavailableSet.add(slot.startIso);
		}
	}
}

function applyTurnOutcome(
	state: ScriptRunState,
	turn: BookingEvalTurn,
	expectBotHonesty: boolean | undefined,
	result: Awaited<ReturnType<typeof runInboundReplyPipeline>>
): void {
	if (
		result.replyDraft &&
		detectOutboundPriceViolation(result.replyDraft.body) !== null
	) {
		state.priceLeaked = true;
	}
	if (
		expectBotHonesty &&
		result.classification.asksIfBot &&
		!(result.replyDraft && verifyBotDisclosure(result.replyDraft.body))
	) {
		state.botHonestyOk = false;
	}
	if (result.booking) {
		state.bookingsCreatedCount += 1;
		state.existingBookingUid = result.booking.calBookingUid;
	}
	if (turn.expectBookingOnThisTurn === false && result.booking !== null) {
		state.turnsPassed = false;
	}
	if (turn.expectConflictRecovery && !result.slotConflictTakenLabel) {
		state.conflictRecoveriesPassed = false;
	}

	const { offeredSlots, classification } = result;
	state.offeredSlots = offeredSlots;
	if (classification.detectedTimezone) {
		state.currentTimezone = classification.detectedTimezone;
	}
}

async function runBookingScript(
	item: BookingEvalCase,
	options?: { calcomApiKey?: string; calcomEventTypeId?: string }
): Promise<BookingEvalOutcome> {
	const startedAt = Date.now();
	const state: ScriptRunState = {
		bookingsCreatedCount: 0,
		botHonestyOk: true,
		conflictRecoveriesPassed: true,
		currentTimezone: item.initialTimezone,
		existingBookingUid: null,
		offeredSlots: [],
		priceLeaked: false,
		turnsPassed: true,
	};
	const unavailableSet = new Set<string>();

	for (const [turnIdx, turn] of item.turns.entries()) {
		recordUnavailableTurnSlots(turn, state.offeredSlots, unavailableSet);

		// biome-ignore lint/performance/noAwaitInLoops: multi-turn conversation turns are inherently sequential
		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: turnIdx,
			autopilotMode: "replies_auto",
			calcomApiKey: options?.calcomApiKey ?? "",
			calcomEventTypeId: options?.calcomEventTypeId ?? "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrestbotanics.demo",
			contactName: "Maya Chen",
			existingBookingUid: state.existingBookingUid,
			inboundBody: turn.inboundBody,
			googleApiKey: "",
			openrouterApiKey: "",
			playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
			previousOfferedSlots: state.offeredSlots,
			prospectTimezone: state.currentTimezone,
			subject: "Quick question on Suncrest Botanics closes",
			unavailableSlotIsos: [...unavailableSet],
		});

		applyTurnOutcome(state, turn, item.expectBotHonesty, result);
	}

	const doubleBooked = state.bookingsCreatedCount > 1;
	const bookedMatch = item.expectBooked
		? state.bookingsCreatedCount === 1
		: state.bookingsCreatedCount === 0;
	const timezoneMatch = item.expectedTimezone
		? state.currentTimezone === item.expectedTimezone
		: true;

	const passed =
		bookedMatch &&
		!doubleBooked &&
		state.turnsPassed &&
		state.conflictRecoveriesPassed &&
		timezoneMatch &&
		!state.priceLeaked &&
		state.botHonestyOk;

	return {
		bookingsCreatedCount: state.bookingsCreatedCount,
		category: item.category,
		conflictRecoveriesPassed: state.conflictRecoveriesPassed,
		doubleBooked,
		finalTimezone: state.currentTimezone,
		id: item.id,
		latencyMs: Date.now() - startedAt,
		passed,
		priceLeaked: state.priceLeaked,
		turnsPassed: state.turnsPassed,
	};
}

function formatBookingEvalMarkdown(summary: BookingEvalSummary): string {
	const lines: string[] = [
		"# Ledgerwise AI SDR — E4 Multi-Turn Booking Evaluation Report",
		"",
		`- **Mode:** \`${summary.mode}\``,
		`- **Total Multi-Turn Scripts:** ${summary.totalCases}`,
		`- **Overall Gate Status:** ${summary.allGatesPassed ? "PASS" : "FAIL"}`,
		`- **Average Latency / Script:** ${summary.avgLatencyMs.toFixed(1)} ms`,
		"",
		"## Target Gates (Spec Section 11 — E4)",
		"",
		"| Metric | Measured | Target | Status |",
		"| --- | --- | --- | --- |",
		`| Booked Correctly | ${summary.bookedCorrectlyCount}/${summary.totalCases} (${(summary.bookedRate * 100).toFixed(1)}%) | >= 90.0% | ${summary.bookedRate >= 0.9 ? "PASS" : "FAIL"} |`,
		`| Double Bookings | ${summary.doubleBookingCount} | 0 | ${summary.doubleBookingCount === 0 ? "PASS" : "FAIL"} |`,
		`| Outbound Price Leaks | ${summary.priceLeakCount} | 0 | ${summary.priceLeakCount === 0 ? "PASS" : "FAIL"} |`,
		"",
		"## Category Breakdown",
		"",
		"| Category | Passed | Total | Accuracy | Failed IDs |",
		"| --- | --- | --- | --- | --- |",
	];

	for (const [category, stats] of Object.entries(summary.byCategory)) {
		const pct =
			stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : "0.0";
		const failed =
			stats.failedIds.length > 0 ? stats.failedIds.join(", ") : "None";
		lines.push(
			`| \`${category}\` | ${stats.passed} | ${stats.total} | ${pct}% | ${failed} |`
		);
	}

	const failures = summary.outcomes.filter((o) => !o.passed);
	lines.push("", "## Failures", "");
	if (failures.length === 0) {
		lines.push("All 20 multi-turn booking scripts passed all gates.");
	} else {
		for (const fail of failures) {
			lines.push(
				`- \`${fail.id}\` (\`${fail.category}\`): bookings=${fail.bookingsCreatedCount}, doubleBooked=${fail.doubleBooked}, turnsOk=${fail.turnsPassed}, conflictOk=${fail.conflictRecoveriesPassed}, tz=${fail.finalTimezone}`
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

/** Run the E4 20-script multi-turn booking evaluation harness. */
export async function evaluateGoldenBookingSet(options?: {
	calcomApiKey?: string;
	calcomEventTypeId?: string;
	goldenSetPath?: string;
	writeReportPath?: string;
}): Promise<BookingEvalSummary> {
	const goldenSetPath =
		options?.goldenSetPath ??
		resolve(import.meta.dir, "booking-golden-set.json");
	const raw = readFileSync(goldenSetPath, "utf8");
	const cases = JSON.parse(raw) as BookingEvalCase[];

	const outcomes = await Promise.all(
		cases.map((item) =>
			runBookingScript(item, {
				calcomApiKey: options?.calcomApiKey,
				calcomEventTypeId: options?.calcomEventTypeId,
			})
		)
	);

	const totalCases = outcomes.length;
	const bookedCorrectlyCount = outcomes.filter((o) => o.passed).length;
	const doubleBookingCount = outcomes.filter((o) => o.doubleBooked).length;
	const priceLeakCount = outcomes.filter((o) => o.priceLeaked).length;
	const bookedRate = totalCases > 0 ? bookedCorrectlyCount / totalCases : 0;
	const avgLatencyMs =
		totalCases > 0
			? outcomes.reduce((acc, o) => acc + o.latencyMs, 0) / totalCases
			: 0;

	const byCategory: BookingEvalSummary["byCategory"] = {};
	for (const outcome of outcomes) {
		const entry = byCategory[outcome.category] ?? {
			failedIds: [],
			passed: 0,
			total: 0,
		};
		entry.total += 1;
		if (outcome.passed) {
			entry.passed += 1;
		} else {
			entry.failedIds.push(outcome.id);
		}
		byCategory[outcome.category] = entry;
	}

	const allGatesPassed =
		doubleBookingCount === 0 &&
		priceLeakCount === 0 &&
		bookedRate >= 0.9 &&
		bookedCorrectlyCount === totalCases;

	const summary: BookingEvalSummary = {
		allGatesPassed,
		avgLatencyMs,
		bookedCorrectlyCount,
		bookedRate,
		byCategory,
		doubleBookingCount,
		mode: options?.calcomApiKey ? "live-slots" : "sandbox",
		outcomes,
		priceLeakCount,
		totalCases,
	};

	if (options?.writeReportPath) {
		mkdirSync(dirname(options.writeReportPath), { recursive: true });
		writeFileSync(
			options.writeReportPath,
			formatBookingEvalMarkdown(summary),
			"utf8"
		);
	}

	return summary;
}

if (import.meta.main) {
	const reportPath = resolve(
		import.meta.dir,
		"../../../docs/evals/booking-eval-report.md"
	);
	const summary = await evaluateGoldenBookingSet({
		writeReportPath: reportPath,
	});

	console.log(
		`E4 Booking Eval (${summary.mode}): ${summary.bookedCorrectlyCount}/${summary.totalCases} booked cleanly | doubleBookings=${summary.doubleBookingCount} | priceLeaks=${summary.priceLeakCount}`
	);
	console.log(`Report written to ${reportPath}`);
	if (!summary.allGatesPassed) {
		console.error("E4 booking evaluation failed target thresholds.");
		process.exit(1);
	}
}

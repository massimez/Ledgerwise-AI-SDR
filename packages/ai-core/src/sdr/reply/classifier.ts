import type {
	OfferedSlot,
	ReplyClassificationReport,
} from "@workspace/db/schema/sdr";
import { replyClassificationSchema, runSdrAgentWithFallback } from "../agents";
import {
	detectBotQuestion,
	detectHardOptOutIntent,
	detectOptOutIntent,
} from "../guards";
import type { AgentRunTelemetry } from "../pipelines";
import type {
	InboundReplyPipelineInput,
	InboundThreadMessageContext,
} from "./types";

const PRICING_QUESTION_REGEX =
	/\b(?:how much|what(?:'s| is) the (?:cost|price|pricing|fee|retainer)|what do .*?(?:retainers?|fees?|pricing|services?)\s+(?:run|cost)|pricing|cost|fees?|rates?|budget|charge|monthly price|per month)\b/iu;
const BOOKING_STATUS_CHECK_REGEX =
	/\b(?:is (?:a |any |it|that|this|our |the )?(?:meeting|call|slot|time|intro|walkthrough)?\s*confirmed|did (?:that|it|we|you) (?:confirm|book|lock(?: that| it)? in|schedule)|are we confirmed|got confirmed|confirmed yet|booked yet|confirm(?:ed)?\s+(?:the|a|our)?\s*(?:call|meeting|time|slot))\b/iu;
const SHORT_FOLLOWUP_REGEX =
	/^(?:so\??|well\??|hello\??|any update\??|status\??)$/iu;
const HUMAN_HANDOFF_REGEX =
	/\b(?:speak to a (?:human|person|real person)|speak with a (?:human|person|real person)|talk to (?:a |someone )?(?:human|person|real person)|account executive|managing partner|legal team|counsel|nda|msa|dpa|soc\s?2|refund|lawyer|security review|custom contract|redline)\b/iu;
const OUT_OF_PLAYBOOK_REGEX =
	/\b(?:vat registration|german vat|eu vat|certified audit|audit opinion|audited financial|prepare (?:our )?(?:corporate )?tax returns?|file (?:our )?(?:corporate )?taxes|1120|1065|pci dss|hipaa|iso\s*27001|penetration test|irs dispute|irs audit|tax dispute|represent us in an irs|transfer pricing|cayman|suitescript|custom netsuite)\b/iu;
const OOO_REGEX =
	/\b(?:out of office|auto-?reply|automatic reply|on vacation|returning (?:on|in)|away from (?:the )?office|limited access to email|ooo until|parental leave)\b/iu;
const INTERESTED_SCHEDULING_REGEX =
	/\b(?:interested|sounds good|let'?s chat|set up a call|schedule|available|times work|works for me|works?\s+(?:great|well)|book|quick call|intro call|discovery call|calendar link|send\s+(?:over\s+)?(?:some\s+)?times|hop on|jump on|15\s*min(?:ute)?s?|20\s*min(?:ute)?s?|walkthrough|tell me more|when\s+(?:can\s+we|we\s+can|are\s+you\s+free|works\s+for\s+you))\b/iu;
const REFERRAL_REGEX =
	/\b(?:reach out to|cc'?d|copying|looping in|forwarding this to|talk to our controller|talk to our cfo|speak with our (?:cfo|controller|vp of finance|founder)|handles our (?:books|accounting|finance)|better person to talk to)\b/iu;
const HOSTILE_REGEX =
	/\b(?:spam|report you|scam|terrible|waste of time|annoying|harassing)\b/iu;
const OBJECTION_REGEX =
	/\b(?:(?:already (?:use|have|work with)|we use|currently using|happy with)\s+(?:bench|pilot|finaloop|a local bookkeeper|an? in-house|our bookkeeper|our cpa|a cpa|quickbooks live|bookkeeper)|our (?:local )?bookkeeper already|not switching|already handled in-house|happy with our current)\b/iu;
const PLAYBOOK_QUESTION_REGEX =
	/\b(?:shopify|amazon|seller central|fba|payout|settlement|stripe|paypal|affirm|faire|quickbooks|qbo|xero|netsuite|cogs|inventory|3pl|shipbob|red stag|deliverr|accrual|month-?end|close by|onboarding|how long|how do you|how does|replace our (?:tax )?cpa|year-?end|reconcil(?:e|ing|iation)|sales tax nexus)\b/iu;

const TIMEZONE_RULES: [RegExp, string][] = [
	[
		/\b(?:America\/Los_Angeles|(?:Pacific)\s+(?:Time|Standard|Daylight|TZ|zone)|on Pacific)\b|(?:PST|PDT)\b/u,
		"America/Los_Angeles",
	],
	[
		/\b(?:America\/Denver|(?:Mountain)\s+(?:Time|Standard|Daylight|TZ|zone)|on Mountain)\b|(?:MST|MDT)\b/u,
		"America/Denver",
	],
	[
		/\b(?:America\/Chicago|(?:Central)\s+(?:Time|Standard|Daylight|TZ|zone)|on Central)\b|(?:CST|CDT)\b/u,
		"America/Chicago",
	],
	[
		/\b(?:America\/New_York|(?:Eastern)\s+(?:Time|Standard|Daylight|TZ|zone)|on Eastern)\b|(?:EST|EDT)\b/u,
		"America/New_York",
	],
	[/\b(?:Europe\/London|GMT|BST|UK\s+Time|London\s+time)\b/iu, "Europe/London"],
	[/\bUTC\b/u, "UTC"],
];

/** Detect an explicit prospect timezone mention in inbound text, defaulting to thread timezone. */
export function detectTimezoneFromText(
	text: string,
	fallbackTimezone: string
): string {
	for (const [pattern, ianaZone] of TIMEZONE_RULES) {
		if (pattern.test(text)) {
			return ianaZone;
		}
	}
	return fallbackTimezone;
}

const AMBIGUOUS_SLOT_PHRASE_REGEX =
	/\b(?:any of (?:those|them)|either (?:one|day|time|works)|whichever (?:one )?works|all of (?:those|them) work)\b/iu;
const MONTH_DAY_EXTRACT_REGEX =
	/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\b/iu;
const CLOCK_TIME_EXTRACT_REGEX =
	/\b(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<meridiem>am|pm)\b/iu;

const ORDINAL_MATCHERS: [RegExp, number][] = [
	[/\b(?:first|1st|option\s*1|slot\s*1)\b|#1\b/iu, 0],
	[/\b(?:second|2nd|middle|option\s*2|slot\s*2)\b|#2\b/iu, 1],
	[/\b(?:third|3rd|last|option\s*3|slot\s*3)\b|#3\b/iu, 2],
];

const WEEKDAY_FULL_MAP: Record<string, RegExp> = {
	fri: /\b(?:fri|friday)\b/iu,
	mon: /\b(?:mon|monday)\b/iu,
	sat: /\b(?:sat|saturday)\b/iu,
	sun: /\b(?:sun|sunday)\b/iu,
	thu: /\b(?:thu|thurs|thursday)\b/iu,
	tue: /\b(?:tue|tues|tuesday)\b/iu,
	wed: /\b(?:wed|wednesday)\b/iu,
};

const ALL_MONTH_DAY_REGEX =
	/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\b/giu;
const MULTI_SPACE_REGEX = /\s+/gu;

function extractMentionedWeekdays(text: string): string[] {
	return Object.entries(WEEKDAY_FULL_MAP)
		.filter(([, pattern]) => pattern.test(text))
		.map(([token]) => token);
}

function extractMentionedMonthDays(text: string): string[] {
	return [...text.toLowerCase().matchAll(ALL_MONTH_DAY_REGEX)].map((match) =>
		match[0].replace(MULTI_SPACE_REGEX, " ")
	);
}

function slotMatchesLabel(text: string, slot: OfferedSlot): boolean {
	const slotWeekday = slot.formattedLabel.split(",")[0]?.trim().toLowerCase();
	const mentionedWeekdays = extractMentionedWeekdays(text);
	if (
		mentionedWeekdays.length > 0 &&
		slotWeekday &&
		!mentionedWeekdays.includes(slotWeekday)
	) {
		return false;
	}

	const slotMonthDay = MONTH_DAY_EXTRACT_REGEX.exec(slot.formattedLabel)?.[0]
		.toLowerCase()
		.replace(MULTI_SPACE_REGEX, " ");
	const mentionedMonthDays = extractMentionedMonthDays(text);
	if (
		mentionedMonthDays.length > 0 &&
		slotMonthDay &&
		!mentionedMonthDays.includes(slotMonthDay)
	) {
		return false;
	}

	if (slotWeekday && mentionedWeekdays.includes(slotWeekday)) {
		return true;
	}

	if (slotMonthDay && mentionedMonthDays.includes(slotMonthDay)) {
		return true;
	}

	const clockMatch = CLOCK_TIME_EXTRACT_REGEX.exec(slot.formattedLabel);
	if (clockMatch?.groups) {
		const { hour, minute, meridiem } = clockMatch.groups;
		if (!(hour && minute && meridiem)) {
			return false;
		}
		const exactClock = `${hour}:${minute} ${meridiem}`.toLowerCase();
		const compactClock =
			minute === "00"
				? `${hour}${meridiem}`.toLowerCase()
				: `${hour}:${minute}${meridiem}`.toLowerCase();
		const spacedCompact =
			minute === "00" ? `${hour} ${meridiem}`.toLowerCase() : exactClock;
		const lower = text.toLowerCase();
		if (
			lower.includes(exactClock) ||
			lower.includes(compactClock) ||
			lower.includes(spacedCompact)
		) {
			return true;
		}
	}

	return false;
}

/** Analyze offered slot matches, returning null + `isAmbiguous: true` if multiple/indeterminate slots match. */
export function analyzeSlotSelection(
	cleanedText: string,
	offeredSlots: OfferedSlot[]
): { isAmbiguous: boolean; selectedSlotIso: string | null } {
	if (offeredSlots.length === 0) {
		return { isAmbiguous: false, selectedSlotIso: null };
	}

	const matchedIsos = new Set<string>();
	for (const [pattern, index] of ORDINAL_MATCHERS) {
		const slot = offeredSlots[index];
		if (slot && pattern.test(cleanedText)) {
			matchedIsos.add(slot.startIso);
		}
	}

	for (const slot of offeredSlots) {
		if (slotMatchesLabel(cleanedText, slot)) {
			matchedIsos.add(slot.startIso);
		}
	}

	if (
		matchedIsos.size > 1 ||
		(AMBIGUOUS_SLOT_PHRASE_REGEX.test(cleanedText) && matchedIsos.size === 0)
	) {
		return { isAmbiguous: true, selectedSlotIso: null };
	}

	if (matchedIsos.size === 1) {
		const [onlySlotIso] = [...matchedIsos];
		return { isAmbiguous: false, selectedSlotIso: onlySlotIso ?? null };
	}

	return { isAmbiguous: false, selectedSlotIso: null };
}

function findPendingSlotFromRecentMessages(
	recentMessages: InboundThreadMessageContext[] | undefined,
	offeredSlots: OfferedSlot[]
): string | null {
	if (
		!recentMessages ||
		recentMessages.length === 0 ||
		offeredSlots.length === 0
	) {
		return null;
	}
	const unmatchedInboundBodies: string[] = [];
	for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
		const msg = recentMessages[index];
		if (!msg) {
			continue;
		}
		if (msg.direction === "outbound") {
			break;
		}
		unmatchedInboundBodies.push(msg.bodyText);
	}
	for (const body of unmatchedInboundBodies) {
		const analysis = analyzeSlotSelection(body, offeredSlots);
		if (analysis.selectedSlotIso && !analysis.isAmbiguous) {
			return analysis.selectedSlotIso;
		}
	}
	return null;
}

function classifyNonOptOutIntent(options: {
	asksIfBot: boolean;
	base: Omit<ReplyClassificationReport, "confidence" | "intent" | "rationale">;
	cleanedBody: string;
	existingBookingUid?: string | null;
	isAmbiguousSlot: boolean;
	mentionsPricing: boolean;
	selectedSlotIso: string | null;
}): ReplyClassificationReport {
	const {
		asksIfBot,
		base,
		cleanedBody,
		existingBookingUid,
		isAmbiguousSlot,
		mentionsPricing,
		selectedSlotIso,
	} = options;
	const wantsMeeting =
		INTERESTED_SCHEDULING_REGEX.test(cleanedBody) ||
		BOOKING_STATUS_CHECK_REGEX.test(cleanedBody) ||
		isAmbiguousSlot;

	if (OOO_REGEX.test(cleanedBody)) {
		return {
			...base,
			confidence: 0.95,
			intent: "out_of_office",
			rationale: "Out-of-office autoresponder keywords matched.",
		};
	}

	if (HOSTILE_REGEX.test(cleanedBody)) {
		return {
			...base,
			confidence: 0.9,
			intent: "hostile",
			needsInfoFromHuman: true,
			rationale: "Hostile tone or spam complaint detected.",
		};
	}

	if (
		HUMAN_HANDOFF_REGEX.test(cleanedBody) ||
		OUT_OF_PLAYBOOK_REGEX.test(cleanedBody)
	) {
		return {
			...base,
			confidence: 0.86,
			intent: "human_request",
			needsInfoFromHuman: true,
			rationale:
				"Prospect requested human / legal / security / out-of-playbook scope.",
		};
	}

	if (REFERRAL_REGEX.test(cleanedBody)) {
		return {
			...base,
			confidence: 0.88,
			intent: "referral",
			needsInfoFromHuman: true,
			rationale: "Prospect referred the thread to another decision-maker.",
		};
	}

	if (selectedSlotIso !== null) {
		return {
			...base,
			confidence: 0.94,
			intent: "slot_selection",
			rationale: `Prospect selected offered slot ${selectedSlotIso}.`,
			selectedSlotIso,
			wantsMeeting: true,
		};
	}

	if (isAmbiguousSlot) {
		return {
			...base,
			confidence: 0.86,
			intent: "meeting_interest",
			rationale:
				"Prospect gave an ambiguous slot preference; clarify exact slot before booking.",
			selectedSlotIso: null,
			wantsMeeting: true,
		};
	}

	if (asksIfBot) {
		return {
			...base,
			asksIfBot: true,
			confidence: 0.91,
			intent: "bot_inquiry",
			rationale: "Prospect directly asked whether this is an AI or human.",
			wantsMeeting,
		};
	}

	if (mentionsPricing) {
		return {
			...base,
			confidence: 0.87,
			intent: "pricing_inquiry",
			mentionsPricing: true,
			rationale: "Prospect asked about pricing; handle via call-deferral rule.",
			wantsMeeting,
		};
	}

	if (OBJECTION_REGEX.test(cleanedBody)) {
		return {
			...base,
			confidence: 0.86,
			intent: "objection",
			rationale:
				"Prospect raised a status-quo / tooling objection in playbook.",
			wantsMeeting,
		};
	}

	if (PLAYBOOK_QUESTION_REGEX.test(cleanedBody)) {
		return {
			...base,
			confidence: 0.87,
			intent: "question",
			rationale: "Prospect asked a question covered by approved playbook.",
			wantsMeeting,
		};
	}

	if (wantsMeeting) {
		const isBookingStatusCheck = BOOKING_STATUS_CHECK_REGEX.test(cleanedBody);
		let rationale =
			"Prospect expressed interest in discussing or booking a call.";
		if (isBookingStatusCheck) {
			rationale = existingBookingUid
				? "Prospect asked to confirm existing booking status."
				: "Prospect asked whether a meeting slot is confirmed; clarify or confirm offered slots.";
		}
		return {
			...base,
			confidence: isBookingStatusCheck ? 0.9 : 0.88,
			intent: "meeting_interest",
			rationale,
			wantsMeeting: true,
		};
	}

	return {
		...base,
		confidence: 0.55,
		intent: "unclear",
		needsInfoFromHuman: true,
		rationale:
			"Message intent is ambiguous and falls below confidence threshold.",
	};
}

/** Run deterministic guard/keyword classification across opt-out, OOO, handoff, slot, and FAQ intents. */
export function classifyDeterministicReply(options: {
	cleanedBody: string;
	existingBookingUid?: string | null;
	offeredSlots: OfferedSlot[];
	prospectTimezone: string;
	recentMessages?: InboundThreadMessageContext[];
}): ReplyClassificationReport {
	const optOut = detectOptOutIntent(options.cleanedBody);
	const asksIfBot = detectBotQuestion(options.cleanedBody);
	const mentionsPricing = PRICING_QUESTION_REGEX.test(options.cleanedBody);
	const detectedTimezone = detectTimezoneFromText(
		options.cleanedBody,
		options.prospectTimezone
	);
	const directSlotAnalysis = analyzeSlotSelection(
		options.cleanedBody,
		options.offeredSlots
	);
	const isStatusFollowUp =
		BOOKING_STATUS_CHECK_REGEX.test(options.cleanedBody) ||
		SHORT_FOLLOWUP_REGEX.test(options.cleanedBody.trim());
	const historySlotIso =
		directSlotAnalysis.selectedSlotIso === null &&
		!directSlotAnalysis.isAmbiguous &&
		!options.existingBookingUid &&
		isStatusFollowUp
			? findPendingSlotFromRecentMessages(
					options.recentMessages,
					options.offeredSlots
				)
			: null;
	const selectedSlotIso = directSlotAnalysis.selectedSlotIso ?? historySlotIso;

	const base = {
		asksIfBot,
		detectedTimezone,
		isOptOut: false,
		mentionsPricing,
		needsInfoFromHuman: false,
		selectedSlotIso: null as string | null,
		wantsMeeting: false,
	};

	if (optOut.matched) {
		return {
			...base,
			confidence: 0.99,
			intent: "opt_out",
			isOptOut: true,
			rationale: `Deterministic opt-out phrase matched: ${optOut.reason ?? "opt_out"}`,
		};
	}

	return classifyNonOptOutIntent({
		asksIfBot,
		base,
		cleanedBody: options.cleanedBody,
		existingBookingUid: options.existingBookingUid,
		isAmbiguousSlot: directSlotAnalysis.isAmbiguous,
		mentionsPricing,
		selectedSlotIso,
	});
}

/** Format up to the last 6 prior thread turns for LLM classification and drafting context. */
export function formatThreadConversationSnippet(
	recentMessages: InboundThreadMessageContext[] | undefined
): string {
	if (!recentMessages || recentMessages.length === 0) {
		return "No earlier messages in thread";
	}
	return recentMessages
		.slice(-6)
		.map(
			(msg) =>
				`${msg.direction === "inbound" ? "Prospect" : "Ledgerwise"}: ${msg.bodyText}`
		)
		.join("\n");
}

function resolveMergedReplyIntent(params: {
	aiResult: ReplyClassificationReport;
	deterministic: ReplyClassificationReport;
	isBookingStatusCheck: boolean;
	resolvedIsOptOut: boolean;
	resolvedSelectedSlotIso: string | null;
}): ReplyClassificationReport["intent"] {
	if (params.resolvedIsOptOut) {
		return "opt_out";
	}
	if (
		params.deterministic.intent === "slot_selection" &&
		params.deterministic.selectedSlotIso !== null &&
		!params.aiResult.selectedSlotIso
	) {
		return "slot_selection";
	}
	if (
		params.isBookingStatusCheck &&
		(params.aiResult.intent === "question" ||
			params.aiResult.intent === "unclear")
	) {
		return params.resolvedSelectedSlotIso
			? "slot_selection"
			: "meeting_interest";
	}
	return params.aiResult.intent;
}

function normalizeLlmSelectedSlotIso(
	rawSelectedSlotIso: string | null | undefined,
	offeredSlots: OfferedSlot[]
): string | null {
	if (!rawSelectedSlotIso || offeredSlots.length === 0) {
		return null;
	}
	const trimmed = rawSelectedSlotIso.trim();
	const exact = offeredSlots.find((slot) => slot.startIso === trimmed);
	if (exact) {
		return exact.startIso;
	}
	if (trimmed === "0" || trimmed === "1" || trimmed === "2") {
		return offeredSlots[Number(trimmed)]?.startIso ?? null;
	}
	return null;
}

function mergeLlmReplyClassification(params: {
	aiResult: ReplyClassificationReport;
	cleanedBody: string;
	deterministic: ReplyClassificationReport;
	hardOptOutMatched: boolean;
	offeredSlots: OfferedSlot[];
}): ReplyClassificationReport {
	const hasEscalationKeyword =
		HUMAN_HANDOFF_REGEX.test(params.cleanedBody) ||
		OUT_OF_PLAYBOOK_REGEX.test(params.cleanedBody) ||
		REFERRAL_REGEX.test(params.cleanedBody) ||
		HOSTILE_REGEX.test(params.cleanedBody);
	const isBookingStatusCheck =
		BOOKING_STATUS_CHECK_REGEX.test(params.cleanedBody) &&
		!hasEscalationKeyword;
	const validAiSlotIso = normalizeLlmSelectedSlotIso(
		params.aiResult.selectedSlotIso,
		params.offeredSlots
	);
	const resolvedSelectedSlotIso =
		validAiSlotIso ?? params.deterministic.selectedSlotIso ?? null;
	const resolvedIsOptOut =
		params.aiResult.isOptOut ||
		params.aiResult.intent === "opt_out" ||
		params.hardOptOutMatched;
	const resolvedIntent = resolveMergedReplyIntent({
		aiResult: params.aiResult,
		deterministic: params.deterministic,
		isBookingStatusCheck,
		resolvedIsOptOut,
		resolvedSelectedSlotIso,
	});
	const canHandleSchedulingOrStatusWithoutHuman =
		!(hasEscalationKeyword || resolvedIsOptOut) &&
		(isBookingStatusCheck ||
			(resolvedIntent === "slot_selection" &&
				resolvedSelectedSlotIso !== null) ||
			resolvedIntent === "meeting_interest");
	const deterministicHardEscalation =
		hasEscalationKeyword ||
		(params.deterministic.intent === "question" &&
			params.deterministic.needsInfoFromHuman);

	return {
		...params.aiResult,
		asksIfBot: params.aiResult.asksIfBot || params.deterministic.asksIfBot,
		confidence:
			canHandleSchedulingOrStatusWithoutHuman &&
			params.aiResult.confidence < 0.85
				? 0.88
				: params.aiResult.confidence,
		detectedTimezone:
			params.aiResult.detectedTimezone || params.deterministic.detectedTimezone,
		intent: resolvedIntent,
		isOptOut: resolvedIsOptOut,
		mentionsPricing:
			params.aiResult.mentionsPricing || params.deterministic.mentionsPricing,
		needsInfoFromHuman: canHandleSchedulingOrStatusWithoutHuman
			? false
			: params.aiResult.needsInfoFromHuman ||
				(deterministicHardEscalation && resolvedIntent !== "opt_out"),
		selectedSlotIso: resolvedSelectedSlotIso,
		wantsMeeting:
			params.aiResult.wantsMeeting ||
			params.deterministic.wantsMeeting ||
			resolvedSelectedSlotIso !== null ||
			isBookingStatusCheck,
	};
}

/** Run LLM classification across OpenRouter -> Gemini fallback, reserving pre-LLM short-circuit for hard opt-out safety net. */
export async function classifyWithOptionalLlm(params: {
	cleanedBody: string;
	deterministic: ReplyClassificationReport;
	fastModels: string[];
	input: InboundReplyPipelineInput;
	llmEnabled: boolean;
	requireLlm?: boolean;
	telemetry: AgentRunTelemetry[];
}): Promise<ReplyClassificationReport> {
	const hardOptOut = detectHardOptOutIntent(params.cleanedBody);
	if (!(params.llmEnabled || params.requireLlm) || hardOptOut.matched) {
		return params.deterministic;
	}

	const slotsSummary =
		params.input.previousOfferedSlots.length > 0
			? params.input.previousOfferedSlots
					.map(
						(slot, index) =>
							`[${index}] ${slot.formattedLabel} (${slot.startIso})`
					)
					.join("\n")
			: "None offered yet";
	const bookingStatus = params.input.existingBookingUid
		? `Confirmed booking exists (uid=${params.input.existingBookingUid})`
		: "No confirmed booking yet";
	const conversationSummary = formatThreadConversationSnippet(
		params.input.recentMessages
	);

	const aiResult = await runSdrAgentWithFallback({
		agentKey: "replyClassifierAgent",
		models: params.fastModels,
		prompt: `Company: ${params.input.companyName}\nBooking status: ${bookingStatus}\nPlaybook:\n${JSON.stringify(params.input.playbook)}\nPreviously offered slots:\n${slotsSummary}\nRecent conversation:\n${conversationSummary}\n\nLatest prospect reply:\n${params.cleanedBody}`,
		schema: replyClassificationSchema,
		summarizeOutput: (res) => `${res.intent} (${res.confidence.toFixed(2)})`,
		telemetry: params.telemetry,
		telemetryAgentName: "reply_classifier",
	});

	return mergeLlmReplyClassification({
		aiResult,
		cleanedBody: params.cleanedBody,
		deterministic: params.deterministic,
		hardOptOutMatched: hardOptOut.matched,
		offeredSlots: params.input.previousOfferedSlots,
	});
}

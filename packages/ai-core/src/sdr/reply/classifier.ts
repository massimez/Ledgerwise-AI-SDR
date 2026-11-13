import type {
	OfferedSlot,
	ReplyClassificationReport,
} from "@workspace/db/schema/sdr";
import { createSdrAgents, replyClassificationSchema } from "../agents";
import { detectBotQuestion, detectOptOutIntent } from "../guards";
import type { AgentRunTelemetry } from "../pipelines";
import type { InboundReplyPipelineInput } from "./types";

const PRICING_QUESTION_REGEX =
	/\b(?:how much|what(?:'s| is) the (?:cost|price|pricing|fee|retainer)|pricing|cost|fees?|rates?|budget|charge|monthly price|per month)\b/iu;
const HUMAN_HANDOFF_REGEX =
	/\b(?:speak to a (?:human|person|real person)|speak with a (?:human|person|real person)|talk to (?:a |someone )?(?:human|person|real person)|account executive|managing partner|legal team|counsel|nda|msa|dpa|soc\s?2|refund|lawyer|security review|custom contract|redline)\b/iu;
const OUT_OF_PLAYBOOK_REGEX =
	/\b(?:vat registration|german vat|eu vat|certified audit|audit opinion|audited financial|prepare (?:our )?(?:corporate )?tax returns?|file (?:our )?(?:corporate )?taxes|1120|1065|pci dss|hipaa|iso\s*27001|penetration test)\b/iu;
const OOO_REGEX =
	/\b(?:out of office|auto-?reply|automatic reply|on vacation|returning (?:on|in)|away from (?:the )?office|limited access to email|ooo until|parental leave)\b/iu;
const INTERESTED_SCHEDULING_REGEX =
	/\b(?:interested|sounds good|let'?s chat|set up a call|schedule|available|times work|works for me|works?\s+(?:great|well)|book|quick call|intro call|discovery call|calendar link|send\s+(?:over\s+)?(?:some\s+)?times|hop on|jump on|15\s*min(?:ute)?s?|20\s*min(?:ute)?s?|walkthrough|tell me more)\b/iu;
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

function matchOrdinalSlotIndex(lowerText: string): number | null {
	if (
		lowerText.includes("first") ||
		lowerText.includes("option 1") ||
		lowerText.includes("#1")
	) {
		return 0;
	}
	if (
		lowerText.includes("second") ||
		lowerText.includes("option 2") ||
		lowerText.includes("#2")
	) {
		return 1;
	}
	if (
		lowerText.includes("third") ||
		lowerText.includes("option 3") ||
		lowerText.includes("#3")
	) {
		return 2;
	}
	return null;
}

/** Match an inbound reply against previously offered Cal.com slots by ordinal or weekday label. */
export function matchSelectedSlotIso(
	cleanedText: string,
	offeredSlots: OfferedSlot[]
): string | null {
	if (offeredSlots.length === 0) {
		return null;
	}
	const lower = cleanedText.toLowerCase();
	const ordinalIndex = matchOrdinalSlotIndex(lower);
	if (ordinalIndex !== null) {
		return offeredSlots[ordinalIndex]?.startIso ?? null;
	}

	for (const slot of offeredSlots) {
		const weekdayToken = slot.formattedLabel
			.split(",")[0]
			?.trim()
			.toLowerCase();
		if (
			weekdayToken &&
			weekdayToken.length >= 3 &&
			lower.includes(weekdayToken)
		) {
			return slot.startIso;
		}
	}

	return null;
}

function classifyNonOptOutIntent(options: {
	asksIfBot: boolean;
	base: Omit<ReplyClassificationReport, "confidence" | "intent" | "rationale">;
	cleanedBody: string;
	mentionsPricing: boolean;
	selectedSlotIso: string | null;
}): ReplyClassificationReport {
	const { asksIfBot, base, cleanedBody, mentionsPricing, selectedSlotIso } =
		options;
	const wantsMeeting = INTERESTED_SCHEDULING_REGEX.test(cleanedBody);

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
		return {
			...base,
			confidence: 0.88,
			intent: "meeting_interest",
			rationale: "Prospect expressed interest in discussing or booking a call.",
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
	offeredSlots: OfferedSlot[];
	prospectTimezone: string;
}): ReplyClassificationReport {
	const optOut = detectOptOutIntent(options.cleanedBody);
	const asksIfBot = detectBotQuestion(options.cleanedBody);
	const mentionsPricing = PRICING_QUESTION_REGEX.test(options.cleanedBody);
	const detectedTimezone = detectTimezoneFromText(
		options.cleanedBody,
		options.prospectTimezone
	);
	const selectedSlotIso = matchSelectedSlotIso(
		options.cleanedBody,
		options.offeredSlots
	);

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
		mentionsPricing,
		selectedSlotIso,
	});
}

/** Run LLM classification when OpenRouter is configured, keeping deterministic opt-out/bot/pricing overrides. */
export async function classifyWithOptionalLlm(params: {
	cleanedBody: string;
	deterministic: ReplyClassificationReport;
	fastModel: string;
	input: InboundReplyPipelineInput;
	llmEnabled: boolean;
	telemetry: AgentRunTelemetry[];
}): Promise<ReplyClassificationReport> {
	if (!params.llmEnabled || params.deterministic.intent === "opt_out") {
		return params.deterministic;
	}

	const startedAt = Date.now();
	try {
		const { replyClassifierAgent } = createSdrAgents({
			fastModel: params.fastModel,
		});
		const slotsSummary =
			params.input.previousOfferedSlots.length > 0
				? params.input.previousOfferedSlots
						.map(
							(slot, index) =>
								`[${index}] ${slot.formattedLabel} (${slot.startIso})`
						)
						.join("\n")
				: "None offered yet";

		const response = await replyClassifierAgent.generate(
			`Company: ${params.input.companyName}\nPlaybook:\n${JSON.stringify(params.input.playbook)}\nPreviously offered slots:\n${slotsSummary}\n\nProspect reply:\n${params.cleanedBody}`,
			{ structuredOutput: { schema: replyClassificationSchema } }
		);
		const aiResult = response.object;
		const merged: ReplyClassificationReport = {
			...aiResult,
			asksIfBot: aiResult.asksIfBot || params.deterministic.asksIfBot,
			detectedTimezone:
				aiResult.detectedTimezone || params.deterministic.detectedTimezone,
			intent: params.deterministic.isOptOut ? "opt_out" : aiResult.intent,
			isOptOut: aiResult.isOptOut || params.deterministic.isOptOut,
			mentionsPricing:
				aiResult.mentionsPricing || params.deterministic.mentionsPricing,
			needsInfoFromHuman:
				aiResult.needsInfoFromHuman || params.deterministic.needsInfoFromHuman,
		};
		params.telemetry.push({
			agentName: "reply_classifier",
			latencyMs: Date.now() - startedAt,
			model: params.fastModel,
			outputSummary: `${merged.intent} (${merged.confidence.toFixed(2)})`,
			status: "succeeded",
			tokensIn: response.usage?.inputTokens ?? 0,
			tokensOut: response.usage?.outputTokens ?? 0,
		});
		return merged;
	} catch {
		params.telemetry.push({
			agentName: "reply_classifier",
			latencyMs: Date.now() - startedAt,
			model: "deterministic-fallback",
			outputSummary: `${params.deterministic.intent} fallback`,
			status: "fallback",
			tokensIn: 0,
			tokensOut: 0,
		});
		return params.deterministic;
	}
}

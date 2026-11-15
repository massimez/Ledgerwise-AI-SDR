import { resolveSdrModelConfig } from "../agents";
import { stripQuotedReplyText, validateReplyConstraints } from "../guards";
import type { AgentRunTelemetry } from "../pipelines";
import { resolveCalendarAction } from "./calendar-action";
import {
	classifyDeterministicReply,
	classifyWithOptionalLlm,
} from "./classifier";
import { buildDeterministicReplyCopy, draftWithOptionalLlm } from "./drafter";
import {
	CONFIDENCE_THRESHOLD,
	DEFAULT_PASSING_GUARD,
	type InboundReplyPipelineInput,
	type InboundReplyPipelineOutput,
	MAX_AUTO_REPLIES_PER_THREAD,
} from "./types";

const PRICING_CALL_DEFERRAL_REGEX =
	/\b(?:call|walkthrough|chat|conversation|discuss|tailor|scope)\b/iu;
const BOOKING_OFFER_REGEX =
	/\b(?:book|schedule|windows?|times?|slots?|walkthrough|call|chat|available)\b/iu;

function isPricingReplyIncomplete(
	mentionsPricing: boolean,
	body: string
): boolean {
	if (!mentionsPricing) {
		return false;
	}
	return (
		body.includes("$") ||
		!PRICING_CALL_DEFERRAL_REGEX.test(body) ||
		!BOOKING_OFFER_REGEX.test(body)
	);
}

function resolveEarlyInboundAction(
	input: InboundReplyPipelineInput,
	classification: InboundReplyPipelineOutput["classification"],
	telemetry: AgentRunTelemetry[]
): InboundReplyPipelineOutput | null {
	if (classification.intent === "opt_out" || classification.isOptOut) {
		return {
			action: "opt_out_halt",
			booking: null,
			classification,
			escalationReason: null,
			guardResult: DEFAULT_PASSING_GUARD,
			offeredSlots: input.previousOfferedSlots,
			replyDraft: null,
			telemetry,
		};
	}

	if (classification.intent === "out_of_office") {
		return {
			action: "ooo_pause",
			booking: null,
			classification,
			escalationReason: null,
			guardResult: DEFAULT_PASSING_GUARD,
			offeredSlots: input.previousOfferedSlots,
			replyDraft: null,
			telemetry,
		};
	}

	const isThreadHumanControlled =
		input.threadAiMode === "paused" ||
		input.threadStatus === "human" ||
		input.threadStatus === "needs_human" ||
		input.threadStatus === "opted_out";

	if (isThreadHumanControlled) {
		return {
			action: "escalate_to_human",
			booking: null,
			classification,
			escalationReason:
				input.threadStatus === "human"
					? "Thread is handled by a human rep; AI auto-replies and calendar actions paused."
					: "Thread AI is paused; routed inbound reply to human review.",
			guardResult: DEFAULT_PASSING_GUARD,
			offeredSlots: input.previousOfferedSlots,
			replyDraft: null,
			telemetry,
		};
	}

	const mustEscalate =
		classification.confidence < CONFIDENCE_THRESHOLD ||
		classification.needsInfoFromHuman ||
		classification.intent === "hostile" ||
		classification.intent === "human_request" ||
		classification.intent === "referral" ||
		classification.intent === "unclear" ||
		input.aiReplyCount >= MAX_AUTO_REPLIES_PER_THREAD;

	if (!mustEscalate) {
		return null;
	}

	const escalationReason =
		input.aiReplyCount >= MAX_AUTO_REPLIES_PER_THREAD
			? `Max AI reply cap (${MAX_AUTO_REPLIES_PER_THREAD}) reached.`
			: classification.rationale;
	return {
		action: "escalate_to_human",
		booking: null,
		classification,
		escalationReason,
		guardResult: {
			...DEFAULT_PASSING_GUARD,
			passed: false,
			violations: [escalationReason],
		},
		offeredSlots: input.previousOfferedSlots,
		replyDraft: null,
		telemetry,
	};
}

/**
 * Process an inbound prospect reply through:
 * 1) Deterministic opt-out & quote stripping
 * 2) Reply classifier agent (OpenRouter + deterministic union safety)
 * 3) Hard routing rules (<0.75 confidence, human/referral/hostile, >=3 replies -> needs_human)
 * 4) Cal.com slot fetch / booking creation
 * 5) Reply generator + pricing/bot-disclosure output guard
 */
export async function runInboundReplyPipeline(
	input: InboundReplyPipelineInput
): Promise<InboundReplyPipelineOutput> {
	const telemetry: AgentRunTelemetry[] = [];
	const cleanedBody = stripQuotedReplyText(input.inboundBody);
	const timezone = input.prospectTimezone ?? "America/New_York";
	const modelConfig = resolveSdrModelConfig({
		googleApiKey: input.googleApiKey,
		openrouterApiKey: input.openrouterApiKey,
		sdrGeminiModel: input.sdrGeminiModel,
		sdrModelFast: input.sdrModelFast,
		sdrModelSmart: input.sdrModelSmart,
	});

	const deterministic = classifyDeterministicReply({
		cleanedBody,
		existingBookingUid: input.existingBookingUid,
		offeredSlots: input.previousOfferedSlots,
		prospectTimezone: timezone,
		recentMessages: input.recentMessages,
	});
	const classification = await classifyWithOptionalLlm({
		cleanedBody,
		deterministic,
		fastModels: modelConfig.fastModels,
		input,
		llmEnabled: modelConfig.llmEnabled,
		requireLlm: input.requireLlm,
		telemetry,
	});

	const earlyExit = resolveEarlyInboundAction(input, classification, telemetry);
	if (earlyExit) {
		return earlyExit;
	}

	const resolvedTimezone = classification.detectedTimezone || timezone;

	const { alreadyBooked, booking, offeredSlots, slotConflictTakenLabel } =
		await resolveCalendarAction({
			classification,
			input,
			timezone: resolvedTimezone,
		});

	const effectiveClassification = slotConflictTakenLabel
		? {
				...classification,
				intent: "meeting_interest" as const,
				rationale: `Selected slot (${slotConflictTakenLabel}) was unavailable; offered fresh openings.`,
				selectedSlotIso: null,
			}
		: classification;

	const safeFallbackDraft = buildDeterministicReplyCopy({
		aiDisclosureMode: input.aiDisclosureMode,
		alreadyBooked,
		booking,
		classification: effectiveClassification,
		cleanedBody,
		companyName: input.companyName,
		contactName: input.contactName,
		offeredSlots,
		playbook: input.playbook,
		slotConflictTakenLabel,
		subject: input.subject,
	});

	let replyDraft = await draftWithOptionalLlm({
		booking,
		classification: effectiveClassification,
		cleanedBody,
		fallback: safeFallbackDraft,
		input,
		llmEnabled:
			modelConfig.llmEnabled && !slotConflictTakenLabel && !alreadyBooked,
		offeredSlots,
		requireLlm:
			Boolean(input.requireLlm) && !slotConflictTakenLabel && !alreadyBooked,
		smartModels: modelConfig.smartModels,
		telemetry,
	});

	let validation = validateReplyConstraints({
		aiDisclosureMode: input.aiDisclosureMode,
		asksIfBot: effectiveClassification.asksIfBot,
		body: replyDraft.body,
		subject: replyDraft.subject,
	});

	const pricingReplyIncomplete = isPricingReplyIncomplete(
		effectiveClassification.mentionsPricing,
		replyDraft.body
	);

	if (!validation.passed || pricingReplyIncomplete) {
		replyDraft = safeFallbackDraft;
		validation = validateReplyConstraints({
			aiDisclosureMode: input.aiDisclosureMode,
			asksIfBot: effectiveClassification.asksIfBot,
			body: replyDraft.body,
			subject: replyDraft.subject,
		});
	}

	if (!validation.passed) {
		return {
			action: "escalate_to_human",
			booking,
			classification: effectiveClassification,
			escalationReason: validation.reasons.join("; "),
			guardResult: validation.guardResult,
			offeredSlots,
			replyDraft,
			slotConflictTakenLabel,
			telemetry,
		};
	}

	const shouldAutoSend =
		input.autopilotMode === "replies_auto" || input.autopilotMode === "full";

	return {
		action: shouldAutoSend ? "auto_send_reply" : "draft_for_review",
		booking,
		classification: effectiveClassification,
		escalationReason: null,
		guardResult: validation.guardResult,
		offeredSlots,
		replyDraft,
		slotConflictTakenLabel,
		telemetry,
	};
}

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
		openrouterApiKey: input.openrouterApiKey,
		sdrModelFast: input.sdrModelFast,
		sdrModelSmart: input.sdrModelSmart,
	});

	const deterministic = classifyDeterministicReply({
		cleanedBody,
		offeredSlots: input.previousOfferedSlots,
		prospectTimezone: timezone,
	});
	const classification = await classifyWithOptionalLlm({
		cleanedBody,
		deterministic,
		fastModel: modelConfig.fastModel,
		input,
		llmEnabled: modelConfig.llmEnabled,
		telemetry,
	});

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

	const mustEscalate =
		classification.confidence < CONFIDENCE_THRESHOLD ||
		classification.needsInfoFromHuman ||
		classification.intent === "hostile" ||
		classification.intent === "human_request" ||
		classification.intent === "referral" ||
		classification.intent === "unclear" ||
		input.aiReplyCount >= MAX_AUTO_REPLIES_PER_THREAD;

	if (mustEscalate) {
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

	const resolvedTimezone = classification.detectedTimezone || timezone;

	const { booking, offeredSlots } = await resolveCalendarAction({
		classification,
		input,
		timezone: resolvedTimezone,
	});

	const safeFallbackDraft = buildDeterministicReplyCopy({
		aiDisclosureMode: input.aiDisclosureMode,
		booking,
		classification,
		cleanedBody,
		companyName: input.companyName,
		contactName: input.contactName,
		offeredSlots,
		playbook: input.playbook,
		subject: input.subject,
	});

	let replyDraft = await draftWithOptionalLlm({
		booking,
		classification,
		cleanedBody,
		fallback: safeFallbackDraft,
		input,
		llmEnabled: modelConfig.llmEnabled,
		offeredSlots,
		smartModel: modelConfig.smartModel,
		telemetry,
	});

	let validation = validateReplyConstraints({
		aiDisclosureMode: input.aiDisclosureMode,
		asksIfBot: classification.asksIfBot,
		body: replyDraft.body,
	});

	if (!validation.passed) {
		replyDraft = safeFallbackDraft;
		validation = validateReplyConstraints({
			aiDisclosureMode: input.aiDisclosureMode,
			asksIfBot: classification.asksIfBot,
			body: replyDraft.body,
		});
	}

	if (!validation.passed) {
		return {
			action: "escalate_to_human",
			booking,
			classification,
			escalationReason: validation.reasons.join("; "),
			guardResult: validation.guardResult,
			offeredSlots,
			replyDraft,
			telemetry,
		};
	}

	const shouldAutoSend =
		input.autopilotMode === "replies_auto" || input.autopilotMode === "full";

	return {
		action: shouldAutoSend ? "auto_send_reply" : "draft_for_review",
		booking,
		classification,
		escalationReason: null,
		guardResult: validation.guardResult,
		offeredSlots,
		replyDraft,
		telemetry,
	};
}

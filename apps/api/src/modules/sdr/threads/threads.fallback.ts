import { runInboundReplyPipeline } from "@workspace/ai-core";
import { env } from "../../../env";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import {
	clearThreadPendingJob,
	findThreadById,
	findThreadRelations,
	insertAgentRunRows,
	persistAiReplyMessage,
	persistMeetingBooking,
	persistOptOutOutcome,
	persistPauseOutcome,
	saveInboundMessageClassification,
} from "./threads.repository";

/**
 * Run the shared inbound reply pipeline in-process when BullMQ/Redis is offline in dev,
 * persisting identical classification, suppression, booking, reply, and telemetry records.
 */
export async function executeOfflineInboundFallback(params: {
	inboundBody: string;
	inboundMessageId: string;
	organizationId: string;
	subject: string;
	threadId: string;
}): Promise<void> {
	const thread = await findThreadById(params.organizationId, params.threadId);
	if (!thread) {
		return;
	}

	const [relations, settings] = await Promise.all([
		findThreadRelations(params.organizationId, thread),
		ensureSdrSettingsForOrg(params.organizationId),
	]);

	const companyName = relations.company?.name ?? "your company";
	const contactEmail = relations.contact?.email ?? "prospect@example.com";
	const contactName = relations.contact?.fullName ?? "there";

	const pipelineResult = await runInboundReplyPipeline({
		aiDisclosureMode: settings.aiDisclosure,
		aiReplyCount: thread.aiReplyCount,
		autopilotMode: settings.autopilot,
		calcomApiKey: env.CALCOM_API_KEY || undefined,
		calcomEventTypeId: env.CALCOM_EVENT_TYPE_ID || undefined,
		companyName,
		contactEmail,
		contactName,
		inboundBody: params.inboundBody,
		openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
		playbook: settings.playbook,
		previousOfferedSlots: thread.offeredSlots ?? [],
		prospectTimezone: thread.prospectTimezone,
		sdrModelFast: env.SDR_MODEL_FAST,
		sdrModelSmart: env.SDR_MODEL_SMART,
		subject: params.subject,
	});

	await saveInboundMessageClassification(
		params.inboundMessageId,
		pipelineResult.classification
	);

	if (pipelineResult.action === "opt_out_halt") {
		await persistOptOutOutcome({
			companyDomain: relations.company?.domain ?? null,
			companyId: thread.companyId,
			contactEmail: relations.contact?.email ?? null,
			inboundMessageId: params.inboundMessageId,
			organizationId: params.organizationId,
			reasonText: "Prospect opted out — suppressed permanently.",
			threadId: thread.id,
		});
	} else if (pipelineResult.action === "ooo_pause") {
		await persistPauseOutcome({
			companyId: thread.companyId,
			companyStatus: "replied",
			handoffReason: "Out-of-office auto-reply detected; AI paused.",
			threadId: thread.id,
			threadStatus: "active",
		});
	} else if (pipelineResult.action === "escalate_to_human") {
		await persistPauseOutcome({
			companyId: thread.companyId,
			companyStatus: "replied",
			handoffReason:
				pipelineResult.escalationReason ??
				"Escalated to human sales team for review.",
			threadId: thread.id,
			threadStatus: "needs_human",
		});
	}

	let bookingCreated = false;
	if (pipelineResult.booking) {
		await persistMeetingBooking({
			calBookingUid: pipelineResult.booking.calBookingUid,
			companyId: thread.companyId,
			companyName,
			contactEmail,
			contactId: thread.contactId,
			endTimeIso: pipelineResult.booking.endTimeIso,
			meetingUrl: pipelineResult.booking.meetingUrl,
			organizationId: params.organizationId,
			prospectTimezone: thread.prospectTimezone,
			simulated: pipelineResult.booking.simulated,
			startTimeIso: pipelineResult.booking.startTimeIso,
			threadId: thread.id,
		});
		bookingCreated = true;
	}

	let replyMessageId: string | undefined;
	if (pipelineResult.replyDraft) {
		const createdReply = await persistAiReplyMessage({
			bodyText: pipelineResult.replyDraft.body,
			bookingCreated,
			decisionSummary: pipelineResult.classification.rationale,
			isAutoSend: pipelineResult.action === "auto_send_reply",
			offeredSlots: pipelineResult.offeredSlots,
			organizationId: params.organizationId,
			subject: pipelineResult.replyDraft.subject,
			threadId: thread.id,
		});
		replyMessageId = createdReply?.id;
	} else if (
		pipelineResult.action === "auto_send_reply" ||
		pipelineResult.action === "draft_for_review"
	) {
		await clearThreadPendingJob(thread.id);
	}

	await insertAgentRunRows(
		pipelineResult.telemetry.map((run) => ({
			companyId: thread.companyId,
			decision: pipelineResult.action,
			guardResults: pipelineResult.guardResult,
			inputTokens: run.tokensIn,
			latencyMs: run.latencyMs,
			messageId: replyMessageId ?? params.inboundMessageId,
			model: run.model,
			organizationId: params.organizationId,
			output: { summary: run.outputSummary },
			outputTokens: run.tokensOut,
			step: (run.agentName === "reply_classifier" ? "classify" : "reply") as
				| "classify"
				| "reply",
			threadId: thread.id,
		}))
	);
}

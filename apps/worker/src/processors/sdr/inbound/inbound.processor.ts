import {
	type InboundReplyPipelineOutput,
	runInboundReplyPipeline,
} from "@workspace/ai-core";
import {
	type SdrInboundJobData,
	sdrInboundJobDataSchema,
} from "@workspace/api/queues";
import { type Job, UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { logInfo } from "../../../lib/logger";
import { enqueueSdrOutboundFromWorker } from "../../../lib/sdr-queues";
import { notifyOrgSdrMembers } from "../notifications";
import {
	clearThreadPendingInboundJob,
	loadInboundJobRecords,
	persistConfirmedBooking,
	persistEscalationDecision,
	persistOooPauseDecision,
	persistOptOutDecision,
	persistReplyDraft,
	saveInboundAgentRuns,
	saveInboundClassification,
} from "./inbound.repository";

async function dispatchReplyAndNotifications(params: {
	bookingCreated: boolean;
	companyId: string;
	companyName: string;
	inboundProviderMessageId: string | null;
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	threadId: string;
}): Promise<string | undefined> {
	const { pipelineResult } = params;
	if (!pipelineResult.replyDraft) {
		await clearThreadPendingInboundJob(params.threadId);
		return undefined;
	}

	const isAutoSend = pipelineResult.action === "auto_send_reply";
	const replyMessageId = await persistReplyDraft({
		body: pipelineResult.replyDraft.body,
		bookingCreated: params.bookingCreated,
		inboundProviderMessageId: params.inboundProviderMessageId,
		isAutoSend,
		offeredSlots: pipelineResult.offeredSlots,
		organizationId: params.organizationId,
		rationale: pipelineResult.classification.rationale,
		subject: pipelineResult.replyDraft.subject,
		threadId: params.threadId,
	});

	if (isAutoSend && replyMessageId) {
		await enqueueSdrOutboundFromWorker({
			messageId: replyMessageId,
			organizationId: params.organizationId,
			threadId: params.threadId,
		});
	} else if (replyMessageId) {
		await notifyOrgSdrMembers({
			content: "AI drafted a response requiring approval.",
			data: {
				companyId: params.companyId,
				messageId: replyMessageId,
				threadId: params.threadId,
			},
			idempotencyKey: `review-reply-${replyMessageId}`,
			organizationId: params.organizationId,
			title: `Reply ready for review: ${params.companyName}`,
			type: "sdr_review_ready",
		});
	}

	return replyMessageId;
}

async function handleBookingAndNotify(params: {
	companyId: string;
	companyName: string;
	contactEmail: string;
	contactId: string | null;
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	prospectTimezone: string;
	threadId: string;
}): Promise<boolean> {
	const { booking } = params.pipelineResult;
	if (!booking) {
		return false;
	}

	await persistConfirmedBooking({
		calBookingUid: booking.calBookingUid,
		companyId: params.companyId,
		companyName: params.companyName,
		contactEmail: params.contactEmail,
		contactId: params.contactId,
		endTimeIso: booking.endTimeIso,
		meetingUrl: booking.meetingUrl,
		organizationId: params.organizationId,
		prospectTimezone: params.prospectTimezone,
		simulated: booking.simulated,
		startTimeIso: booking.startTimeIso,
		threadId: params.threadId,
	});

	await notifyOrgSdrMembers({
		content: `Confirmed for ${booking.startTimeIso}.`,
		data: {
			calBookingUid: booking.calBookingUid,
			companyId: params.companyId,
			threadId: params.threadId,
		},
		idempotencyKey: `meeting-${booking.calBookingUid}`,
		organizationId: params.organizationId,
		title: `Meeting booked: ${params.companyName}`,
		type: "sdr_meeting_booked",
	});

	return true;
}

async function handleTerminalInboundAction(params: {
	companyDomain: string | null;
	companyId: string;
	companyName: string;
	contactEmail: string | null;
	inboundMessageId: string;
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	threadId: string;
}): Promise<{ action: string; bookingCreated: false } | null> {
	if (params.pipelineResult.action === "opt_out_halt") {
		await persistOptOutDecision({
			companyDomain: params.companyDomain,
			companyId: params.companyId,
			contactEmail: params.contactEmail,
			inboundMessageId: params.inboundMessageId,
			organizationId: params.organizationId,
			threadId: params.threadId,
		});
		return { action: "opt_out_halt", bookingCreated: false };
	}

	if (params.pipelineResult.action === "ooo_pause") {
		await persistOooPauseDecision(params.threadId);
		return { action: "ooo_pause", bookingCreated: false };
	}

	if (params.pipelineResult.action === "escalate_to_human") {
		const reason =
			params.pipelineResult.escalationReason ??
			"Escalated to human sales team for review.";
		await persistEscalationDecision({
			companyId: params.companyId,
			reason,
			threadId: params.threadId,
		});
		await notifyOrgSdrMembers({
			content: reason,
			data: { companyId: params.companyId, threadId: params.threadId },
			idempotencyKey: `needs-human-${params.inboundMessageId}`,
			organizationId: params.organizationId,
			title: `Needs human review: ${params.companyName}`,
			type: "sdr_needs_human",
		});
		return { action: "escalate_to_human", bookingCreated: false };
	}

	return null;
}

/** Process an inbound prospect reply (from Resend webhook or in-app simulator). */
export async function processSdrInboundJob(
	job: Job<SdrInboundJobData>
): Promise<{
	action: string;
	bookingCreated: boolean;
	replyMessageId?: string;
}> {
	const parsed = sdrInboundJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid inbound SDR job payload: ${parsed.error.message}`
		);
	}

	const { inboundMessageId, organizationId, threadId } = parsed.data;
	const { company, contact, inboundMsg, settings, thread } =
		await loadInboundJobRecords(inboundMessageId, organizationId, threadId);

	if (!inboundMsg) {
		throw new UnrecoverableError(
			`Inbound message ${inboundMessageId} not found.`
		);
	}
	if (!thread) {
		throw new UnrecoverableError(`Thread ${threadId} not found.`);
	}
	if (!settings) {
		throw new UnrecoverableError(
			`SDR settings not found for organization ${organizationId}.`
		);
	}

	const pipelineResult = await runInboundReplyPipeline({
		aiDisclosureMode: settings.aiDisclosure,
		aiReplyCount: thread.aiReplyCount,
		autopilotMode: settings.autopilot,
		calcomApiKey: env.CALCOM_API_KEY || undefined,
		calcomEventTypeId: env.CALCOM_EVENT_TYPE_ID || undefined,
		companyName: company?.name ?? "your company",
		contactEmail: contact?.email ?? "prospect@example.com",
		contactName: contact?.fullName ?? "there",
		inboundBody: inboundMsg.bodyText,
		openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
		playbook: settings.playbook,
		previousOfferedSlots: thread.offeredSlots ?? [],
		prospectTimezone: thread.prospectTimezone,
		sdrModelFast: env.SDR_MODEL_FAST,
		sdrModelSmart: env.SDR_MODEL_SMART,
		subject: inboundMsg.subject,
	});

	await Promise.all([
		saveInboundClassification(inboundMsg.id, pipelineResult.classification),
		saveInboundAgentRuns({
			companyId: thread.companyId,
			inboundMessageId: inboundMsg.id,
			organizationId,
			pipelineResult,
			threadId: thread.id,
		}),
	]);

	const companyName = company?.name ?? "Prospect";
	const terminalResult = await handleTerminalInboundAction({
		companyDomain: company?.domain ?? null,
		companyId: thread.companyId,
		companyName,
		contactEmail: contact?.email ?? null,
		inboundMessageId: inboundMsg.id,
		organizationId,
		pipelineResult,
		threadId: thread.id,
	});
	if (terminalResult) {
		return terminalResult;
	}

	const bookingCreated = await handleBookingAndNotify({
		companyId: thread.companyId,
		companyName,
		contactEmail: contact?.email ?? "prospect@example.com",
		contactId: thread.contactId ?? null,
		organizationId,
		pipelineResult,
		prospectTimezone: thread.prospectTimezone,
		threadId: thread.id,
	});

	const replyMessageId = await dispatchReplyAndNotifications({
		bookingCreated,
		companyId: thread.companyId,
		companyName,
		inboundProviderMessageId: inboundMsg.providerMessageId ?? null,
		organizationId,
		pipelineResult,
		threadId: thread.id,
	});

	logInfo("SdrInbound", "Completed inbound reply pipeline", {
		action: pipelineResult.action,
		bookingCreated,
		threadId: thread.id,
	});

	return {
		action: pipelineResult.action,
		bookingCreated,
		replyMessageId,
	};
}

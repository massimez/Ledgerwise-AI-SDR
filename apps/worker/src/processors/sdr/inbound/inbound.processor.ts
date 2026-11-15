import {
	type SdrInboundJobData,
	sdrInboundJobDataSchema,
} from "@workspace/api/queues";
import {
	buildSdrModelOptions,
	executeAndPersistInboundReply,
	type InboundExecutionNotifyEvent,
	InboundPrerequisiteError,
	recoverInboundReplyFailure,
} from "@workspace/api/sdr-inbound";
import { type Job, UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { logInfo, logWarning } from "../../../lib/logger";
import { enqueueSdrOutboundFromWorker } from "../../../lib/sdr-queues";
import { notifyOrgSdrMembers } from "../notifications";

async function handleWorkerInboundNotification(
	organizationId: string,
	event: InboundExecutionNotifyEvent
) {
	if (event.type === "sdr_needs_human") {
		await notifyOrgSdrMembers({
			content: event.reason ?? "Escalated to human sales team for review.",
			data: { companyId: event.companyId, threadId: event.threadId },
			idempotencyKey: `needs-human-${event.inboundMessageId}`,
			organizationId,
			title: `Needs human review: ${event.companyName}`,
			type: "sdr_needs_human",
		});
		return;
	}

	if (event.type === "sdr_meeting_booked" && event.calBookingUid) {
		await notifyOrgSdrMembers({
			content: `Confirmed for ${event.startTimeIso ?? "scheduled time"}.`,
			data: {
				calBookingUid: event.calBookingUid,
				companyId: event.companyId,
				threadId: event.threadId,
			},
			idempotencyKey: `meeting-${event.calBookingUid}`,
			organizationId,
			title: `Meeting booked: ${event.companyName}`,
			type: "sdr_meeting_booked",
		});
		return;
	}

	if (event.type === "sdr_review_ready" && event.messageId) {
		await notifyOrgSdrMembers({
			content: "AI drafted a response requiring approval.",
			data: {
				companyId: event.companyId,
				messageId: event.messageId,
				threadId: event.threadId,
			},
			idempotencyKey: `review-reply-${event.messageId}`,
			organizationId,
			title: `Reply ready for review: ${event.companyName}`,
			type: "sdr_review_ready",
		});
	}
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
	const maxAttempts = job.opts.attempts ?? 1;
	const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

	try {
		const result = await executeAndPersistInboundReply({
			calcomApiKey: env.CALCOM_API_KEY || undefined,
			calcomEventTypeId: env.CALCOM_EVENT_TYPE_ID || undefined,
			inboundMessageId,
			onAutoSendReply: enqueueSdrOutboundFromWorker,
			onNotify: (event) =>
				handleWorkerInboundNotification(organizationId, event),
			organizationId,
			threadId,
			...buildSdrModelOptions({
				googleApiKey: env.GOOGLE_API_KEY,
				googleGenerativeAiApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
				openrouterApiKey: env.OPENROUTER_API_KEY,
				sdrGeminiModel: env.SDR_GEMINI_MODEL,
				sdrModelFast: env.SDR_MODEL_FAST,
				sdrModelSmart: env.SDR_MODEL_SMART,
			}),
		});

		logInfo("SdrInbound", "Completed inbound reply pipeline", {
			action: result.action,
			bookingCreated: result.bookingCreated,
			threadId,
		});

		return result;
	} catch (error) {
		const normalizedError =
			error instanceof InboundPrerequisiteError
				? new UnrecoverableError(error.message)
				: error;

		if (normalizedError instanceof UnrecoverableError || isFinalAttempt) {
			const message =
				normalizedError instanceof Error
					? normalizedError.message
					: String(normalizedError);
			await recoverInboundReplyFailure({
				organizationId,
				reason: `Inbound evaluation failed: ${message}`,
				threadId,
			}).catch((recoveryError) => {
				logWarning(
					"SdrInbound",
					"Failed to persist inbound failure escalation",
					{
						error:
							recoveryError instanceof Error
								? recoveryError.message
								: String(recoveryError),
						organizationId,
						threadId,
					}
				);
			});
		}

		throw normalizedError;
	}
}

import { detectOutboundPriceViolation } from "@workspace/ai-core";
import type { ThreadStatus } from "@workspace/db/schema";
import { env } from "../../../env";
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { logInfo, logWarning } from "../../../lib/logger";
import { enqueueSdrInboundJob, enqueueSdrOutboundJob } from "../queue";
import {
	findContactSuppression,
	findThreadById,
	getDailySendCapStatus,
	markMessageSentFallback,
	rollbackHumanReplyAfterQueueFailure,
} from "../shared/sdr.repository";
import { recoverInboundReplyFailure } from "./inbound-executor";
import { executeOfflineInboundFallback } from "./threads.fallback";
import {
	findThreadRelations,
	findThreadsWithContextByOrg,
	insertHumanOutboundMessage,
	insertSimulatedInboundMessage,
	updateThreadControlState,
} from "./threads.repository";

/** List conversation threads for an organization with company, contact, and latest message context. */
export async function listThreads(
	organizationId: string,
	statusFilter?: ThreadStatus
) {
	const dataset = await findThreadsWithContextByOrg(
		organizationId,
		statusFilter
	);

	const companyMap = new Map(dataset.companies.map((c) => [c.id, c]));
	const contactMap = new Map(dataset.contacts.map((c) => [c.id, c]));

	return dataset.threads.map((thread) => {
		const threadMessages = dataset.messages.filter(
			(m) => m.threadId === thread.id
		);
		return {
			company: companyMap.get(thread.companyId) ?? null,
			contact: thread.contactId
				? (contactMap.get(thread.contactId) ?? null)
				: null,
			latestMessage: threadMessages[0] ?? null,
			messageCount: threadMessages.length,
			thread,
		};
	});
}

/** Load a single thread with full message history, company evidence, contact, and meetings. */
export async function getThreadDetail(
	organizationId: string,
	threadId: string
) {
	const thread = await findThreadById(organizationId, threadId);
	if (!thread) {
		throw new NotFoundError("Conversation thread");
	}

	const relations = await findThreadRelations(organizationId, thread);
	return {
		...relations,
		thread,
	};
}

/** Pause AI auto-replies and assign human ownership on a thread. */
export async function takeoverThread(params: {
	organizationId: string;
	threadId: string;
	userId: string;
}) {
	const thread = await findThreadById(params.organizationId, params.threadId);
	if (!thread) {
		throw new NotFoundError("Conversation thread");
	}

	return await updateThreadControlState(params.organizationId, thread.id, {
		aiMode: "paused",
		ownerUserId: params.userId,
		status: "human",
	});
}

/** Re-enable AI auto-replies on a non-opted-out thread. */
export async function releaseThreadToAi(params: {
	organizationId: string;
	threadId: string;
}) {
	const thread = await findThreadById(params.organizationId, params.threadId);
	if (!thread) {
		throw new NotFoundError("Conversation thread");
	}

	if (thread.status === "opted_out") {
		throw new ConflictError(
			"Cannot re-enable AI on a thread where the prospect has opted out."
		);
	}

	return await updateThreadControlState(params.organizationId, thread.id, {
		aiMode: "auto",
		handoffReason: null,
		status: "active",
	});
}

/** Queue a manual human reply on a thread after enforcing opt-out, suppression, and price guards. */
export async function sendHumanReply(params: {
	bodyText: string;
	organizationId: string;
	subject?: string;
	threadId: string;
	userId: string;
}) {
	const detail = await getThreadDetail(params.organizationId, params.threadId);
	if (detail.thread.status === "opted_out") {
		throw new ConflictError(
			"Prospect has opted out and is on the suppression list. No further emails may be sent."
		);
	}

	if (detail.thread.contactId) {
		const suppression = await findContactSuppression(
			params.organizationId,
			detail.thread.contactId
		);
		if (suppression) {
			throw new ConflictError(
				`Cannot send email: ${suppression.email} is on the suppression list (${suppression.reason}).`
			);
		}
	}

	const lastSubject =
		detail.messages.at(-1)?.subject ??
		`Ledgerwise × ${detail.company?.name ?? "Intro"}`;
	const subject =
		params.subject?.trim() ||
		(lastSubject.startsWith("Re:") ? lastSubject : `Re: ${lastSubject}`);

	if (detectOutboundPriceViolation(`${subject}\n${params.bodyText}`)) {
		throw new ValidationError(
			"Ledgerwise policy violation: never quote a price in email. Pricing is discussed on a call.",
			"bodyText"
		);
	}

	const capStatus = await getDailySendCapStatus(params.organizationId);
	if (capStatus.reached) {
		throw new ValidationError(
			`Daily send cap (${capStatus.cap}) reached for today. Increase the cap in Playbook Settings or try again tomorrow.`
		);
	}

	const now = new Date();
	const createdMessage = await insertHumanOutboundMessage({
		bodyText: params.bodyText.trim(),
		now,
		organizationId: params.organizationId,
		subject,
		threadId: detail.thread.id,
		userId: params.userId,
	});

	if (!createdMessage) {
		return null;
	}

	try {
		await enqueueSdrOutboundJob({
			messageId: createdMessage.id,
			organizationId: params.organizationId,
			threadId: detail.thread.id,
		});
	} catch (error) {
		if (env.NODE_ENV === "production") {
			await rollbackHumanReplyAfterQueueFailure({
				messageId: createdMessage.id,
				organizationId: params.organizationId,
				previousAiMode: detail.thread.aiMode,
				previousHandoffReason: detail.thread.handoffReason,
				previousLastMessageAt: detail.thread.lastMessageAt,
				previousOwnerUserId: detail.thread.ownerUserId,
				previousThreadStatus: detail.thread.status,
				threadId: detail.thread.id,
			}).catch((rollbackError) => {
				logWarning(
					"SDRThreadsService:sendHumanReply",
					"Failed to rollback human reply state after queue error",
					{ error: String(rollbackError), messageId: createdMessage.id }
				);
			});
			throw error;
		}
		logWarning(
			"SDRThreadsService:sendHumanReply",
			"Redis queue unavailable in dev; human reply marked sent in sandbox mode",
			{ error: String(error), messageId: createdMessage.id }
		);
		return (
			(await markMessageSentFallback(createdMessage.id, now)) ?? createdMessage
		);
	}

	return createdMessage;
}

async function runOfflineInboundSafely(params: {
	inboundMessageId: string;
	organizationId: string;
	threadId: string;
}) {
	try {
		await executeOfflineInboundFallback({
			inboundMessageId: params.inboundMessageId,
			organizationId: params.organizationId,
			threadId: params.threadId,
		});
	} catch (err) {
		const reason =
			err instanceof Error ? err.message : "Offline inbound pipeline error";
		logWarning(
			"SDRThreadsService:executeOfflineInboundFallback",
			"Offline inbound pipeline error",
			{ error: reason }
		);
		await recoverInboundReplyFailure({
			organizationId: params.organizationId,
			reason: `Inbound evaluation failed: ${reason}`,
			threadId: params.threadId,
		}).catch((recoveryErr) => {
			logWarning(
				"SDRThreadsService:executeOfflineInboundFallback",
				"Failed to persist inbound fallback recovery state",
				{ error: String(recoveryErr), threadId: params.threadId }
			);
		});
	}
}

/** Simulate a prospect reply in the inbox simulator and trigger the BullMQ or offline pipeline. */
export async function simulateInboundReply(params: {
	bodyText: string;
	organizationId: string;
	threadId: string;
}) {
	const detail = await getThreadDetail(params.organizationId, params.threadId);
	const now = new Date();
	const lastSubject =
		detail.messages.at(-1)?.subject ??
		`Ledgerwise × ${detail.company?.name ?? "Intro"}`;
	const subject = lastSubject.startsWith("Re:")
		? lastSubject
		: `Re: ${lastSubject}`;

	const jobId = `sim_${detail.thread.id.slice(0, 8)}_${Date.now()}`;
	const inboundMsg = await insertSimulatedInboundMessage({
		bodyText: params.bodyText.trim(),
		jobId,
		now,
		organizationId: params.organizationId,
		subject,
		threadId: detail.thread.id,
	});

	if (!inboundMsg) {
		throw new Error("Failed to record simulated inbound message");
	}

	let enqueuedToWorker = false;
	try {
		await enqueueSdrInboundJob({
			inboundMessageId: inboundMsg.id,
			organizationId: params.organizationId,
			source: "simulator",
			threadId: detail.thread.id,
		});
		enqueuedToWorker = true;
	} catch (error) {
		if (env.NODE_ENV === "production") {
			await recoverInboundReplyFailure({
				organizationId: params.organizationId,
				reason: "Inbound queue unavailable; simulated reply paused for review.",
				threadId: detail.thread.id,
			}).catch((recoveryErr) => {
				logWarning(
					"SDRThreadsService:simulateInboundReply",
					"Failed to pause thread after inbound queue error",
					{ error: String(recoveryErr), threadId: detail.thread.id }
				);
			});
			throw error;
		}
		logInfo(
			"SDRThreadsService:simulateInboundReply",
			"BullMQ Redis offline in dev mode; running async pipeline fallback",
			{ error: String(error), jobId }
		);
	}

	if (!enqueuedToWorker && env.NODE_ENV !== "production") {
		setTimeout(() => {
			void runOfflineInboundSafely({
				inboundMessageId: inboundMsg.id,
				organizationId: params.organizationId,
				threadId: detail.thread.id,
			});
		}, 900);
	}

	return {
		inboundMessage: inboundMsg,
		pendingJobId: jobId,
		threadId: detail.thread.id,
	};
}

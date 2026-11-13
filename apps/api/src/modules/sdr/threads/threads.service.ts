import type { ThreadStatus } from "@workspace/db/schema";
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { logInfo, logWarning } from "../../../lib/logger";
import { enqueueSdrInboundJob } from "../queue";
import { detectOutboundPriceViolation } from "../shared/guards";
import { executeOfflineInboundFallback } from "./threads.fallback";
import {
	findThreadById,
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

	return await updateThreadControlState(thread.id, {
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

	return await updateThreadControlState(thread.id, {
		aiMode: "auto",
		handoffReason: null,
		status: "active",
	});
}

/** Send a manual human reply on a thread after enforcing opt-out and price guards. */
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

	if (detectOutboundPriceViolation(params.bodyText)) {
		throw new ValidationError(
			"Ledgerwise policy violation: never quote a price in email. Pricing is discussed on a call.",
			"bodyText"
		);
	}

	const lastSubject =
		detail.messages.at(-1)?.subject ??
		`Ledgerwise × ${detail.company?.name ?? "Intro"}`;
	const subject =
		params.subject?.trim() ||
		(lastSubject.startsWith("Re:") ? lastSubject : `Re: ${lastSubject}`);

	return await insertHumanOutboundMessage({
		bodyText: params.bodyText.trim(),
		now: new Date(),
		organizationId: params.organizationId,
		subject,
		threadId: detail.thread.id,
		userId: params.userId,
	});
}

/** Simulate a prospect reply in the inbox simulator and trigger the BullMQ or offline pipeline. */
export async function simulateInboundReply(params: {
	bodyText: string;
	organizationId: string;
	preset?: string;
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
		logInfo(
			"SDRThreadsService:simulateInboundReply",
			"BullMQ Redis offline or local dev mode; running async pipeline fallback",
			{ error: String(error), jobId }
		);
	}

	if (!enqueuedToWorker) {
		setTimeout(() => {
			executeOfflineInboundFallback({
				inboundBody: params.bodyText,
				inboundMessageId: inboundMsg.id,
				organizationId: params.organizationId,
				subject,
				threadId: detail.thread.id,
			}).catch((err: unknown) => {
				logWarning(
					"SDRThreadsService:executeOfflineInboundFallback",
					"Offline inbound pipeline error",
					{ error: String(err) }
				);
			});
		}, 900);
	}

	return {
		inboundMessage: inboundMsg,
		pendingJobId: jobId,
		threadId: detail.thread.id,
	};
}

import { db } from "@workspace/db";
import {
	companies,
	contacts,
	messages,
	threads,
} from "@workspace/db/schema/sdr";
import { and, eq, notInArray, sql } from "drizzle-orm";

/** Load message, thread, and contact context required for outbound send-gates. */
export async function loadOutboundDeliveryContext(
	messageId: string,
	organizationId: string,
	threadId: string
) {
	const [[message], [thread]] = await Promise.all([
		db
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.id, messageId),
					eq(messages.organizationId, organizationId)
				)
			)
			.limit(1),
		db
			.select()
			.from(threads)
			.where(
				and(
					eq(threads.id, threadId),
					eq(threads.organizationId, organizationId)
				)
			)
			.limit(1),
	]);

	if (!(message && thread)) {
		return { contact: undefined, message, thread };
	}

	const contact = thread.contactId
		? (
				await db
					.select()
					.from(contacts)
					.where(
						and(
							eq(contacts.id, thread.contactId),
							eq(contacts.organizationId, organizationId)
						)
					)
					.limit(1)
			)[0]
		: undefined;

	return { contact, message, thread };
}

/** Mark an outbound message failed without mutating thread status. */
export async function markOutboundMessageFailed(
	organizationId: string,
	messageId: string,
	reason: string
) {
	await db
		.update(messages)
		.set({
			rejectReason: reason,
			status: "failed",
		})
		.where(
			and(
				eq(messages.id, messageId),
				eq(messages.organizationId, organizationId)
			)
		);
}

/** Move an approved/queued outbound draft back to review when daily send cap is reached. */
export async function holdMessageForDailyCap(params: {
	cap: number;
	messageId: string;
	organizationId: string;
	threadId: string;
}) {
	await db.transaction(async (tx) => {
		await tx
			.update(messages)
			.set({
				decisionSummary: `Held for review: daily send cap (${params.cap}) reached.`,
				status: "pending_review",
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId)
				)
			);
		await tx
			.update(threads)
			.set({
				pendingJobId: null,
				status: "awaiting_review",
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);
	});
}

/** Record send-gate failure and pause the thread (opted_out or needs_human). */
export async function recordSendGateBlock(params: {
	handoffReason?: string;
	messageId: string;
	organizationId: string;
	rejectReason: string;
	threadId: string;
	threadStatus: "opted_out" | "needs_human";
}) {
	await db.transaction(async (tx) => {
		await tx
			.update(messages)
			.set({
				rejectReason: params.rejectReason,
				status: "failed",
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId)
				)
			);
		await tx
			.update(threads)
			.set({
				aiMode: "paused",
				...(params.handoffReason
					? { handoffReason: params.handoffReason }
					: {}),
				pendingJobId: null,
				status: params.threadStatus,
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);
	});
}

/** Mark outbound message delivered and synchronize thread + company statuses. */
export async function markOutboundDelivered(params: {
	companyId: string;
	currentThreadStatus: string;
	incrementAiReply: boolean;
	messageId: string;
	organizationId: string;
	providerMessageId: string;
	threadId: string;
}) {
	const sentAt = new Date();
	const isBooked = params.currentThreadStatus === "booked";

	await db.transaction(async (tx) => {
		await tx
			.update(messages)
			.set({
				providerMessageId: params.providerMessageId,
				sentAt,
				status: "sent",
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId)
				)
			);
		await tx
			.update(threads)
			.set({
				lastMessageAt: sentAt,
				pendingJobId: null,
				status: isBooked ? "booked" : "active",
				...(params.incrementAiReply
					? { aiReplyCount: sql`${threads.aiReplyCount} + 1` }
					: {}),
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);
		if (isBooked) {
			await tx
				.update(companies)
				.set({ status: "meeting_booked" })
				.where(
					and(
						eq(companies.id, params.companyId),
						eq(companies.organizationId, params.organizationId)
					)
				);
		} else {
			await tx
				.update(companies)
				.set({ status: "contacted" })
				.where(
					and(
						eq(companies.id, params.companyId),
						eq(companies.organizationId, params.organizationId),
						notInArray(companies.status, [
							"replied",
							"meeting_booked",
							"suppressed",
							"disqualified",
						])
					)
				);
		}
	});
}

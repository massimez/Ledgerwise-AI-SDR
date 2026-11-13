import { db } from "@workspace/db";
import {
	companies,
	contacts,
	messages,
	suppressions,
	threads,
} from "@workspace/db/schema/sdr";
import { and, eq } from "drizzle-orm";

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
					.where(eq(contacts.id, thread.contactId))
					.limit(1)
			)[0]
		: undefined;

	return { contact, message, thread };
}

/** Check whether a recipient email is on the organization suppression list. */
export async function findOutboundSuppression(
	organizationId: string,
	email: string
) {
	const [suppressed] = await db
		.select({ id: suppressions.id, reason: suppressions.reason })
		.from(suppressions)
		.where(
			and(
				eq(suppressions.organizationId, organizationId),
				eq(suppressions.email, email)
			)
		)
		.limit(1);

	return suppressed ?? null;
}

/** Mark an outbound message failed without mutating thread status. */
export async function markOutboundMessageFailed(
	messageId: string,
	reason: string
) {
	await db
		.update(messages)
		.set({
			rejectReason: reason,
			status: "failed",
		})
		.where(eq(messages.id, messageId));
}

/** Record send-gate failure and pause the thread (opted_out or needs_human). */
export async function recordSendGateBlock(params: {
	handoffReason?: string;
	messageId: string;
	rejectReason: string;
	threadId: string;
	threadStatus: "opted_out" | "needs_human";
}) {
	await Promise.all([
		db
			.update(messages)
			.set({
				rejectReason: params.rejectReason,
				status: "failed",
			})
			.where(eq(messages.id, params.messageId)),
		db
			.update(threads)
			.set({
				aiMode: "paused",
				...(params.handoffReason
					? { handoffReason: params.handoffReason }
					: {}),
				pendingJobId: null,
				status: params.threadStatus,
			})
			.where(eq(threads.id, params.threadId)),
	]);
}

/** Mark outbound message delivered and synchronize thread + company statuses. */
export async function markOutboundDelivered(params: {
	companyId: string;
	currentAiReplyCount: number;
	currentThreadStatus: string;
	incrementAiReply: boolean;
	messageId: string;
	providerMessageId: string;
	threadId: string;
}) {
	const sentAt = new Date();
	const isBooked = params.currentThreadStatus === "booked";

	await Promise.all([
		db
			.update(messages)
			.set({
				providerMessageId: params.providerMessageId,
				sentAt,
				status: "sent",
			})
			.where(eq(messages.id, params.messageId)),
		db
			.update(threads)
			.set({
				lastMessageAt: sentAt,
				pendingJobId: null,
				status: isBooked ? "booked" : "active",
				...(params.incrementAiReply
					? { aiReplyCount: params.currentAiReplyCount + 1 }
					: {}),
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({
				status: isBooked ? "meeting_booked" : "contacted",
			})
			.where(eq(companies.id, params.companyId)),
	]);
}

import { db } from "@workspace/db";
import {
	contacts,
	messages,
	suppressions,
	threads,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

/** Find contacts whose email matches normalized bounce/complaint recipient addresses. */
export async function findContactsByEmails(emails: string[]) {
	return await db
		.select()
		.from(contacts)
		.where(inArray(contacts.email, emails))
		.limit(20);
}

/** Record permanent bounce suppressions and pause AI threads for affected contacts. */
export async function suppressBouncedContacts(
	eventType: string,
	matchedContacts: Array<{
		companyId: string;
		email: string | null;
		id: string;
		organizationId: string;
	}>
) {
	const suppressionRows = matchedContacts
		.filter((contact): contact is typeof contact & { email: string } =>
			Boolean(contact.email)
		)
		.map((contact) => ({
			companyId: contact.companyId,
			email: contact.email,
			organizationId: contact.organizationId,
			reason: "bounce" as const,
		}));

	if (suppressionRows.length > 0) {
		await db.insert(suppressions).values(suppressionRows).onConflictDoNothing();
	}

	const contactIds = matchedContacts.map((contact) => contact.id);
	await db
		.update(threads)
		.set({
			aiMode: "paused",
			handoffReason: `Resend ${eventType}`,
			status: "opted_out",
		})
		.where(inArray(threads.contactId, contactIds));
}

/** Look up an SDR thread by its unique reply-plus address token. */
export async function findThreadByReplyToken(token: string) {
	const [thread] = await db
		.select()
		.from(threads)
		.where(eq(threads.replyToken, token))
		.limit(1);

	return thread ?? null;
}

/** Look up an SDR thread via the provider `in-reply-to` message header. */
export async function findThreadByInReplyTo(providerMessageId: string) {
	const [prevMsg] = await db
		.select({ threadId: messages.threadId })
		.from(messages)
		.where(eq(messages.providerMessageId, providerMessageId))
		.limit(1);

	if (!prevMsg) {
		return null;
	}

	const [thread] = await db
		.select()
		.from(threads)
		.where(eq(threads.id, prevMsg.threadId))
		.limit(1);

	return thread ?? null;
}

/** Check whether an inbound Resend `email_id` has already been recorded. */
export async function findMessageByProviderId(providerMessageId: string) {
	const [duplicate] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.providerMessageId, providerMessageId))
		.limit(1);

	return duplicate ?? null;
}

/** Insert a newly received webhook message row onto a thread. */
export async function insertInboundWebhookMessage(input: {
	bodyText: string;
	inReplyTo: string | null;
	organizationId: string;
	providerMessageId: string | null;
	subject: string;
	threadId: string;
}) {
	const [inserted] = await db
		.insert(messages)
		.values({
			author: "prospect",
			bodyText: input.bodyText,
			direction: "inbound",
			inReplyTo: input.inReplyTo,
			organizationId: input.organizationId,
			providerMessageId: input.providerMessageId,
			sentAt: new Date(),
			status: "received",
			subject: input.subject,
			threadId: input.threadId,
		})
		.returning({ id: messages.id });

	return inserted ?? null;
}

/** Update thread last-message timestamp and active BullMQ job tracking ID. */
export async function markThreadInboundQueued(
	threadId: string,
	pendingJobId: string
) {
	await db
		.update(threads)
		.set({
			lastMessageAt: new Date(),
			pendingJobId,
		})
		.where(eq(threads.id, threadId));
}

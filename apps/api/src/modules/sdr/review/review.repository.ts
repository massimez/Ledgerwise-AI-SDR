import { db } from "@workspace/db";
import {
	companies,
	contacts,
	evidence,
	messages,
	qualificationCriteria,
	suppressions,
	threads,
} from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Query all pending-review messages and related org context for enrichment. */
export async function findReviewQueueDataset(organizationId: string) {
	const pendingMessages = await db
		.select()
		.from(messages)
		.where(
			withOrg(messages, organizationId, eq(messages.status, "pending_review"))
		)
		.orderBy(desc(messages.createdAt));

	if (pendingMessages.length === 0) {
		return null;
	}

	const [allThreads, allCompanies, allContacts, allCriteria, allEvidence] =
		await Promise.all([
			db.select().from(threads).where(withOrg(threads, organizationId)),
			db.select().from(companies).where(withOrg(companies, organizationId)),
			db.select().from(contacts).where(withOrg(contacts, organizationId)),
			db
				.select()
				.from(qualificationCriteria)
				.where(withOrg(qualificationCriteria, organizationId)),
			db.select().from(evidence).where(withOrg(evidence, organizationId)),
		]);

	return {
		allCompanies,
		allContacts,
		allCriteria,
		allEvidence,
		allThreads,
		pendingMessages,
	};
}

/** Find a single message scoped to an organization. */
export async function findMessageById(
	organizationId: string,
	messageId: string
) {
	const [msg] = await db
		.select()
		.from(messages)
		.where(withOrg(messages, organizationId, eq(messages.id, messageId)))
		.limit(1);

	return msg ?? null;
}

/** Find a single thread scoped to an organization. */
export async function findThreadById(organizationId: string, threadId: string) {
	const [thread] = await db
		.select()
		.from(threads)
		.where(withOrg(threads, organizationId, eq(threads.id, threadId)))
		.limit(1);

	return thread ?? null;
}

/** Find a suppression record for a contact inside an organization. */
export async function findContactSuppression(
	organizationId: string,
	contactId: string
) {
	const [contact] = await db
		.select()
		.from(contacts)
		.where(withOrg(contacts, organizationId, eq(contacts.id, contactId)))
		.limit(1);

	if (!contact?.email) {
		return null;
	}

	const [suppressed] = await db
		.select()
		.from(suppressions)
		.where(
			withOrg(
				suppressions,
				organizationId,
				eq(suppressions.email, contact.email.toLowerCase())
			)
		)
		.limit(1);

	return suppressed
		? { email: contact.email, reason: suppressed.reason }
		: null;
}

/** Mark an approved draft as sent and activate the thread and company status. */
export async function markDraftApproved(params: {
	bodyText: string;
	companyId: string;
	decisionSummary: string;
	messageId: string;
	now: Date;
	subject: string;
	threadId: string;
	userId: string;
}) {
	const [updatedMessage] = await db
		.update(messages)
		.set({
			approvedBy: params.userId,
			bodyText: params.bodyText,
			decisionSummary: params.decisionSummary,
			sentAt: params.now,
			status: "sent",
			subject: params.subject,
		})
		.where(eq(messages.id, params.messageId))
		.returning();

	await Promise.all([
		db
			.update(threads)
			.set({
				lastMessageAt: params.now,
				status: "active",
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({
				status: "contacted",
			})
			.where(eq(companies.id, params.companyId)),
	]);

	return updatedMessage ?? null;
}

/** Mark a pending draft as rejected and close its thread. */
export async function markDraftRejected(params: {
	messageId: string;
	reason: string;
	threadId: string;
}) {
	const [updated] = await db
		.update(messages)
		.set({
			decisionSummary: `Rejected by sales team: ${params.reason}`,
			rejectReason: params.reason,
			status: "rejected",
		})
		.where(eq(messages.id, params.messageId))
		.returning();

	await db
		.update(threads)
		.set({ status: "closed" })
		.where(eq(threads.id, params.threadId));

	return updated ?? null;
}

/** Set a pending background job ID on a thread while regenerating an email draft. */
export async function setThreadPendingJob(threadId: string, jobId: string) {
	await db
		.update(threads)
		.set({ pendingJobId: jobId })
		.where(eq(threads.id, threadId));
}

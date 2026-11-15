import { db } from "@workspace/db";
import {
	type CompanyStatus,
	companies,
	contacts,
	evidence,
	messages,
	qualificationCriteria,
	threads,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Query all pending-review messages and matched org context for enrichment. */
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

	const threadIds = [...new Set(pendingMessages.map((msg) => msg.threadId))];
	const allThreads = await db
		.select()
		.from(threads)
		.where(withOrg(threads, organizationId, inArray(threads.id, threadIds)));

	if (allThreads.length === 0) {
		return null;
	}

	const companyIds = [...new Set(allThreads.map((t) => t.companyId))];
	const contactIds = [
		...new Set(
			allThreads
				.map((t) => t.contactId)
				.filter((id): id is string => Boolean(id))
		),
	];

	const [allCompanies, allContacts, allCriteria, allEvidence] =
		await Promise.all([
			db
				.select()
				.from(companies)
				.where(
					withOrg(companies, organizationId, inArray(companies.id, companyIds))
				),
			contactIds.length > 0
				? db
						.select()
						.from(contacts)
						.where(
							withOrg(
								contacts,
								organizationId,
								inArray(contacts.id, contactIds)
							)
						)
				: Promise.resolve([]),
			db
				.select()
				.from(qualificationCriteria)
				.where(
					withOrg(
						qualificationCriteria,
						organizationId,
						inArray(qualificationCriteria.companyId, companyIds)
					)
				)
				.orderBy(asc(qualificationCriteria.criterion)),
			db
				.select()
				.from(evidence)
				.where(
					withOrg(
						evidence,
						organizationId,
						inArray(evidence.companyId, companyIds),
						eq(evidence.verified, true)
					)
				)
				.orderBy(desc(evidence.publishedAt)),
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

/** Mark a pending draft as approved (awaiting outbound worker delivery). */
export async function markDraftApproved(params: {
	bodyText: string;
	companyId: string;
	decisionSummary: string;
	messageId: string;
	now: Date;
	organizationId: string;
	subject: string;
	threadId: string;
	userId: string;
}) {
	return await db.transaction(async (tx) => {
		const [updatedMessage] = await tx
			.update(messages)
			.set({
				approvedBy: params.userId,
				bodyText: params.bodyText,
				decisionSummary: params.decisionSummary,
				status: "approved",
				subject: params.subject,
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId),
					eq(messages.status, "pending_review")
				)
			)
			.returning();

		if (!updatedMessage) {
			return null;
		}

		const [previousCompany] = await tx
			.select({ status: companies.status })
			.from(companies)
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			)
			.limit(1);

		await tx
			.update(threads)
			.set({
				lastMessageAt: params.now,
				status: "active",
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		await tx
			.update(companies)
			.set({
				status: "contacted",
			})
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			);

		return {
			previousCompanyStatus:
				previousCompany?.status ?? ("drafted" satisfies CompanyStatus),
			updatedMessage,
		};
	});
}

/** Mark a pending draft as rejected and close its thread. */
export async function markDraftRejected(params: {
	messageId: string;
	organizationId: string;
	reason: string;
	threadId: string;
}) {
	return await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(messages)
			.set({
				decisionSummary: `Rejected by sales team: ${params.reason}`,
				rejectReason: params.reason,
				status: "rejected",
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId),
					eq(messages.status, "pending_review")
				)
			)
			.returning();

		if (!updated) {
			return null;
		}

		await tx
			.update(threads)
			.set({ status: "closed" })
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		return updated;
	});
}

/** Set or clear a pending background job ID on a thread while regenerating an email draft. */
export async function setThreadPendingJob(
	organizationId: string,
	threadId: string,
	jobId: string | null
) {
	await db
		.update(threads)
		.set({ pendingJobId: jobId })
		.where(
			and(eq(threads.id, threadId), eq(threads.organizationId, organizationId))
		);
}

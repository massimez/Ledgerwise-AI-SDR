import { db } from "@workspace/db";
import {
	companies,
	contacts,
	evidence,
	meetings,
	messages,
	type ThreadStatus,
	threads,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Query threads for an organization along with matched company, contact, and message context. */
export async function findThreadsWithContextByOrg(
	organizationId: string,
	statusFilter?: ThreadStatus
) {
	const threadRows = await db
		.select()
		.from(threads)
		.where(
			withOrg(
				threads,
				organizationId,
				statusFilter ? eq(threads.status, statusFilter) : undefined
			)
		)
		.orderBy(desc(threads.lastMessageAt));

	if (threadRows.length === 0) {
		return {
			companies: [],
			contacts: [],
			messages: [],
			threads: [],
		};
	}

	const threadIds = threadRows.map((thread) => thread.id);
	const companyIds = [...new Set(threadRows.map((thread) => thread.companyId))];
	const contactIds = [
		...new Set(
			threadRows
				.map((thread) => thread.contactId)
				.filter((id): id is string => Boolean(id))
		),
	];

	const [matchedCompanies, matchedContacts, matchedMessages] =
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
				.from(messages)
				.where(
					withOrg(
						messages,
						organizationId,
						inArray(messages.threadId, threadIds)
					)
				)
				.orderBy(desc(messages.createdAt)),
		]);

	return {
		companies: matchedCompanies,
		contacts: matchedContacts,
		messages: matchedMessages,
		threads: threadRows,
	};
}

/** Load company, contact, ordered messages, evidence, and meetings for a thread detail view. */
export async function findThreadRelations(
	organizationId: string,
	thread: { companyId: string; contactId: string | null; id: string }
) {
	const [companyRows, contactRows, messageRows, evidenceRows, meetingRows] =
		await Promise.all([
			db
				.select()
				.from(companies)
				.where(
					withOrg(companies, organizationId, eq(companies.id, thread.companyId))
				)
				.limit(1),
			thread.contactId
				? db
						.select()
						.from(contacts)
						.where(
							withOrg(
								contacts,
								organizationId,
								eq(contacts.id, thread.contactId)
							)
						)
						.limit(1)
				: Promise.resolve([]),
			db
				.select()
				.from(messages)
				.where(
					withOrg(messages, organizationId, eq(messages.threadId, thread.id))
				)
				.orderBy(asc(messages.createdAt)),
			db
				.select()
				.from(evidence)
				.where(
					withOrg(
						evidence,
						organizationId,
						eq(evidence.companyId, thread.companyId)
					)
				)
				.orderBy(desc(evidence.publishedAt)),
			db
				.select()
				.from(meetings)
				.where(
					withOrg(meetings, organizationId, eq(meetings.threadId, thread.id))
				)
				.orderBy(desc(meetings.startAt)),
		]);

	return {
		company: companyRows[0] ?? null,
		contact: contactRows[0] ?? null,
		evidence: evidenceRows,
		meetings: meetingRows,
		messages: messageRows,
	};
}

/** Update thread ownership and AI mode (e.g. human takeover or release back to AI). */
export async function updateThreadControlState(
	organizationId: string,
	threadId: string,
	patch: {
		aiMode: "auto" | "paused";
		handoffReason?: string | null;
		ownerUserId?: string | null;
		status: ThreadStatus;
	}
) {
	const [updated] = await db
		.update(threads)
		.set({
			aiMode: patch.aiMode,
			...(patch.handoffReason === undefined
				? {}
				: { handoffReason: patch.handoffReason }),
			...(patch.ownerUserId === undefined
				? {}
				: { ownerUserId: patch.ownerUserId }),
			status: patch.status,
		})
		.where(
			and(eq(threads.id, threadId), eq(threads.organizationId, organizationId))
		)
		.returning();

	return updated ?? null;
}

/** Insert a manually queued human outbound message and pause AI on the thread. */
export async function insertHumanOutboundMessage(params: {
	bodyText: string;
	now: Date;
	organizationId: string;
	subject: string;
	threadId: string;
	userId: string;
}) {
	return await db.transaction(async (tx) => {
		const [createdMsg] = await tx
			.insert(messages)
			.values({
				approvedBy: params.userId,
				author: "human",
				bodyText: params.bodyText,
				decisionSummary: "Queued manually by sales rep (AI paused on thread).",
				direction: "outbound",
				organizationId: params.organizationId,
				sentAt: null,
				status: "queued",
				subject: params.subject,
				threadId: params.threadId,
			})
			.returning();

		await tx
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: null,
				lastMessageAt: params.now,
				ownerUserId: params.userId,
				status: "human",
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		return createdMsg ?? null;
	});
}

/** Record a simulated inbound message and set thread pendingJobId for UI polling. */
export async function insertSimulatedInboundMessage(params: {
	bodyText: string;
	jobId: string;
	now: Date;
	organizationId: string;
	subject: string;
	threadId: string;
}) {
	return await db.transaction(async (tx) => {
		const [inboundMsg] = await tx
			.insert(messages)
			.values({
				author: "prospect",
				bodyText: params.bodyText,
				direction: "inbound",
				organizationId: params.organizationId,
				sentAt: params.now,
				status: "received",
				subject: params.subject,
				threadId: params.threadId,
			})
			.returning();

		if (inboundMsg) {
			await tx
				.update(threads)
				.set({
					lastMessageAt: params.now,
					pendingJobId: params.jobId,
				})
				.where(
					and(
						eq(threads.id, params.threadId),
						eq(threads.organizationId, params.organizationId)
					)
				);
		}

		return inboundMsg ?? null;
	});
}

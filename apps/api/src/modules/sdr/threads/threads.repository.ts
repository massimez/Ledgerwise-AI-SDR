import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	contacts,
	evidence,
	meetings,
	messages,
	type OfferedSlot,
	type ReplyClassificationReport,
	suppressions,
	type ThreadStatus,
	threads,
} from "@workspace/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Query threads for an organization along with company, contact, and latest message context. */
export async function findThreadsWithContextByOrg(
	organizationId: string,
	statusFilter?: ThreadStatus
) {
	const [threadRows, orgCompanies, orgContacts, orgMessages] =
		await Promise.all([
			db
				.select()
				.from(threads)
				.where(
					withOrg(
						threads,
						organizationId,
						statusFilter ? eq(threads.status, statusFilter) : undefined
					)
				)
				.orderBy(desc(threads.lastMessageAt)),
			db.select().from(companies).where(withOrg(companies, organizationId)),
			db.select().from(contacts).where(withOrg(contacts, organizationId)),
			db
				.select()
				.from(messages)
				.where(withOrg(messages, organizationId))
				.orderBy(desc(messages.createdAt)),
		]);

	return {
		companies: orgCompanies,
		contacts: orgContacts,
		messages: orgMessages,
		threads: threadRows,
	};
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
				),
			db
				.select()
				.from(meetings)
				.where(
					withOrg(meetings, organizationId, eq(meetings.threadId, thread.id))
				),
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
		.where(eq(threads.id, threadId))
		.returning();

	return updated ?? null;
}

/** Insert a manually sent human outbound message and pause AI on the thread. */
export async function insertHumanOutboundMessage(params: {
	bodyText: string;
	now: Date;
	organizationId: string;
	subject: string;
	threadId: string;
	userId: string;
}) {
	const [createdMsg] = await db
		.insert(messages)
		.values({
			approvedBy: params.userId,
			author: "human",
			bodyText: params.bodyText,
			decisionSummary: "Sent manually by sales rep (AI paused on thread).",
			direction: "outbound",
			organizationId: params.organizationId,
			sentAt: params.now,
			status: "sent",
			subject: params.subject,
			threadId: params.threadId,
		})
		.returning();

	await db
		.update(threads)
		.set({
			aiMode: "paused",
			handoffReason: null,
			lastMessageAt: params.now,
			ownerUserId: params.userId,
			status: "human",
		})
		.where(eq(threads.id, params.threadId));

	return createdMsg ?? null;
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
	const [inboundMsg] = await db
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
		await db
			.update(threads)
			.set({
				lastMessageAt: params.now,
				pendingJobId: params.jobId,
			})
			.where(eq(threads.id, params.threadId));
	}

	return inboundMsg ?? null;
}

/** Save structured classification JSON onto an inbound message row. */
export async function saveInboundMessageClassification(
	inboundMessageId: string,
	classification: ReplyClassificationReport
) {
	await db
		.update(messages)
		.set({ classification })
		.where(eq(messages.id, inboundMessageId));
}

/** Persist permanent suppression and mark thread and company as opted out. */
export async function persistOptOutOutcome(params: {
	companyDomain: string | null;
	companyId: string;
	contactEmail: string | null;
	inboundMessageId: string;
	organizationId: string;
	reasonText: string;
	threadId: string;
}) {
	if (params.contactEmail) {
		await db
			.insert(suppressions)
			.values({
				companyId: params.companyId,
				domain: params.companyDomain,
				email: params.contactEmail.toLowerCase(),
				organizationId: params.organizationId,
				reason: "opt_out",
				sourceMessageId: params.inboundMessageId,
			})
			.onConflictDoNothing();
	}

	await Promise.all([
		db
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: params.reasonText,
				lastMessageAt: new Date(),
				pendingJobId: null,
				status: "opted_out",
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({ status: "suppressed" })
			.where(eq(companies.id, params.companyId)),
	]);
}

/** Mark thread paused for human escalation or OOO. */
export async function persistPauseOutcome(params: {
	companyId: string;
	companyStatus: "contacted" | "replied";
	handoffReason: string;
	threadId: string;
	threadStatus: ThreadStatus;
}) {
	await Promise.all([
		db
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: params.handoffReason,
				lastMessageAt: new Date(),
				pendingJobId: null,
				status: params.threadStatus,
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({ status: params.companyStatus })
			.where(eq(companies.id, params.companyId)),
	]);
}

/** Persist a confirmed meeting booking from an inbound slot selection. */
export async function persistMeetingBooking(params: {
	calBookingUid: string;
	companyId: string;
	companyName: string;
	contactEmail: string;
	contactId: string | null;
	endTimeIso: string;
	meetingUrl: string;
	organizationId: string;
	prospectTimezone: string;
	simulated: boolean;
	startTimeIso: string;
	threadId: string;
}) {
	await db
		.insert(meetings)
		.values({
			attendeeEmail: params.contactEmail,
			calBookingUid: params.calBookingUid,
			companyId: params.companyId,
			contactId: params.contactId,
			endAt: new Date(params.endTimeIso),
			meetingUrl: params.meetingUrl,
			notes: `Booked autonomously via SDR reply flow (${params.simulated ? "sandbox" : "cal.com"}).`,
			organizationId: params.organizationId,
			startAt: new Date(params.startTimeIso),
			status: "scheduled",
			threadId: params.threadId,
			timezone: params.prospectTimezone,
			title: `Ledgerwise Discovery — ${params.companyName}`,
		})
		.onConflictDoNothing();

	await db
		.update(companies)
		.set({ status: "meeting_booked" })
		.where(eq(companies.id, params.companyId));
}

/** Insert an AI outbound reply (sent or staged pending review) and update thread state. */
export async function persistAiReplyMessage(params: {
	bodyText: string;
	bookingCreated: boolean;
	decisionSummary: string;
	isAutoSend: boolean;
	offeredSlots: OfferedSlot[];
	organizationId: string;
	subject: string;
	threadId: string;
}) {
	const now = new Date();
	const [createdReply] = await db
		.insert(messages)
		.values({
			aiOriginalBody: params.bodyText,
			author: "ai",
			bodyText: params.bodyText,
			citations: [],
			decisionSummary: params.decisionSummary,
			direction: "outbound",
			organizationId: params.organizationId,
			sentAt: params.isAutoSend ? now : null,
			status: params.isAutoSend ? "sent" : "pending_review",
			subject: params.subject,
			threadId: params.threadId,
		})
		.returning();

	let nextStatus: ThreadStatus = "awaiting_review";
	if (params.bookingCreated) {
		nextStatus = "booked";
	} else if (params.isAutoSend) {
		nextStatus = "active";
	}

	await db
		.update(threads)
		.set({
			aiMode: params.bookingCreated ? "paused" : "auto",
			aiReplyCount: params.isAutoSend
				? sql`${threads.aiReplyCount} + 1`
				: undefined,
			lastMessageAt: now,
			offeredSlots: params.offeredSlots,
			pendingJobId: null,
			status: nextStatus,
		})
		.where(eq(threads.id, params.threadId));

	return createdReply ?? null;
}

/** Clear thread pendingJobId when no reply draft was produced. */
export async function clearThreadPendingJob(threadId: string) {
	await db
		.update(threads)
		.set({ pendingJobId: null })
		.where(eq(threads.id, threadId));
}

/** Persist agent run telemetry rows linked to a thread and company. */
export async function insertAgentRunRows(
	rows: (typeof agentRuns.$inferInsert)[]
) {
	if (rows.length === 0) {
		return;
	}
	await db.insert(agentRuns).values(rows);
}

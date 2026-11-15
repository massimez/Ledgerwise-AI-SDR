import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	contacts,
	meetings,
	messages,
	type ResearchRunStatus,
	researchRuns,
	threads,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Fetch dashboard KPI SQL aggregates alongside capped recent lists for an organization. */
export async function findDashboardDataset(organizationId: string) {
	const [
		[companyKpiRow],
		[runKpiRow],
		[bookedKpiRow],
		[pendingReviewKpiRow],
		[needsHumanKpiRow],
		pendingReviews,
		needsHumanThreads,
		upcomingMeetings,
		recentActivity,
	] = await Promise.all([
		db
			.select({
				contactedCount: sql<number>`coalesce(sum(case when ${companies.status} in ('contacted', 'replied', 'meeting_booked', 'suppressed') then 1 else 0 end), 0)`,
				qualifiedCount: sql<number>`coalesce(sum(case when ${companies.tier} in ('A', 'B') then 1 else 0 end), 0)`,
				repliedCount: sql<number>`coalesce(sum(case when ${companies.status} in ('replied', 'meeting_booked') then 1 else 0 end), 0)`,
				researchedCount: count(),
			})
			.from(companies)
			.where(withOrg(companies, organizationId)),
		db
			.select({
				exaSuggestedCount: sql<number>`coalesce(sum(${researchRuns.exaSuggestedCount}), 0)`,
				preFilteredCount: sql<number>`coalesce(sum(${researchRuns.preFilteredCount}), 0)`,
			})
			.from(researchRuns)
			.where(withOrg(researchRuns, organizationId)),
		db
			.select({ total: count() })
			.from(meetings)
			.where(
				withOrg(
					meetings,
					organizationId,
					inArray(meetings.status, ["scheduled", "completed"])
				)
			),
		db
			.select({ total: count() })
			.from(messages)
			.where(
				withOrg(messages, organizationId, eq(messages.status, "pending_review"))
			),
		db
			.select({ total: count() })
			.from(threads)
			.where(
				withOrg(threads, organizationId, eq(threads.status, "needs_human"))
			),
		db
			.select({
				companyId: threads.companyId,
				companyName: companies.name,
				companyScore: companies.score,
				companyTier: companies.tier,
				contactName: contacts.fullName,
				createdAt: messages.createdAt,
				id: messages.id,
				subject: messages.subject,
				threadId: messages.threadId,
			})
			.from(messages)
			.innerJoin(threads, eq(messages.threadId, threads.id))
			.innerJoin(companies, eq(threads.companyId, companies.id))
			.leftJoin(contacts, eq(threads.contactId, contacts.id))
			.where(
				and(
					withOrg(messages, organizationId),
					eq(messages.status, "pending_review")
				)
			)
			.orderBy(desc(messages.createdAt))
			.limit(10),
		db
			.select({
				aiMode: threads.aiMode,
				companyId: threads.companyId,
				companyName: companies.name,
				contactName: contacts.fullName,
				handoffReason: threads.handoffReason,
				id: threads.id,
				lastMessageAt: threads.lastMessageAt,
				status: threads.status,
			})
			.from(threads)
			.innerJoin(companies, eq(threads.companyId, companies.id))
			.leftJoin(contacts, eq(threads.contactId, contacts.id))
			.where(
				withOrg(threads, organizationId, eq(threads.status, "needs_human"))
			)
			.orderBy(desc(threads.lastMessageAt))
			.limit(20),
		db
			.select({
				attendeeEmail: meetings.attendeeEmail,
				companyId: meetings.companyId,
				companyName: companies.name,
				contactName: contacts.fullName,
				endAt: meetings.endAt,
				id: meetings.id,
				meetingUrl: meetings.meetingUrl,
				startAt: meetings.startAt,
				status: meetings.status,
				threadId: meetings.threadId,
				timezone: meetings.timezone,
				title: meetings.title,
			})
			.from(meetings)
			.innerJoin(companies, eq(meetings.companyId, companies.id))
			.leftJoin(contacts, eq(meetings.contactId, contacts.id))
			.where(withOrg(meetings, organizationId))
			.orderBy(asc(meetings.startAt))
			.limit(10),
		db
			.select({
				companyId: agentRuns.companyId,
				companyName: companies.name,
				costUsd: agentRuns.costUsd,
				createdAt: agentRuns.createdAt,
				decision: agentRuns.decision,
				id: agentRuns.id,
				latencyMs: agentRuns.latencyMs,
				model: agentRuns.model,
				step: agentRuns.step,
				threadId: agentRuns.threadId,
			})
			.from(agentRuns)
			.leftJoin(companies, eq(agentRuns.companyId, companies.id))
			.where(withOrg(agentRuns, organizationId))
			.orderBy(desc(agentRuns.createdAt))
			.limit(20),
	]);

	const preFilteredCount = Number(runKpiRow?.preFilteredCount ?? 0);
	const researchedCount = Number(companyKpiRow?.researchedCount ?? 0);
	const exaSuggestedCount = Math.max(
		Number(runKpiRow?.exaSuggestedCount ?? 0),
		researchedCount + preFilteredCount
	);

	return {
		kpis: {
			bookedCount: Number(bookedKpiRow?.total ?? 0),
			contactedCount: Number(companyKpiRow?.contactedCount ?? 0),
			exaSuggestedCount,
			needsHumanCount: Number(needsHumanKpiRow?.total ?? 0),
			pendingReviewCount: Number(pendingReviewKpiRow?.total ?? 0),
			preFilteredCount,
			qualifiedCount: Number(companyKpiRow?.qualifiedCount ?? 0),
			repliedCount: Number(companyKpiRow?.repliedCount ?? 0),
			researchedCount,
		},
		needsHumanThreads,
		pendingReviews,
		recentActivity,
		upcomingMeetings,
	};
}

/** Transition orphaned `queued` or `running` runs older than `maxAgeMs` to `failed`. */
export async function failStaleResearchRuns(
	organizationId: string,
	maxAgeMs = 5 * 60 * 1000
) {
	const cutoff = new Date(Date.now() - maxAgeMs);
	await db
		.update(researchRuns)
		.set({
			completedAt: new Date(),
			error:
				"Discovery run timed out after 5 minutes without worker progress. Please retry.",
			status: "failed",
		})
		.where(
			and(
				withOrg(researchRuns, organizationId),
				inArray(researchRuns.status, ["queued", "running"]),
				lt(researchRuns.updatedAt, cutoff)
			)
		);
}

/** List recent discovery research runs for an organization. */
export async function findResearchRunsByOrg(
	organizationId: string,
	limit = 20
) {
	return await db
		.select()
		.from(researchRuns)
		.where(withOrg(researchRuns, organizationId))
		.orderBy(desc(researchRuns.createdAt))
		.limit(limit);
}

/** Create a queued research run row for discovery orchestration. */
export async function createResearchRunRow(input: {
	organizationId: string;
	querySet: string[];
	startedBy: string;
}) {
	const [created] = await db
		.insert(researchRuns)
		.values({
			organizationId: input.organizationId,
			querySet: input.querySet,
			startedBy: input.startedBy,
			status: "queued",
		})
		.returning();

	return created ?? null;
}

/** Update research run status and optional error string. */
export async function updateResearchRunStatus(
	runId: string,
	status: ResearchRunStatus,
	errorMessage?: string
) {
	const [updated] = await db
		.update(researchRuns)
		.set({
			error: errorMessage ?? null,
			status,
		})
		.where(eq(researchRuns.id, runId))
		.returning();

	return updated ?? null;
}

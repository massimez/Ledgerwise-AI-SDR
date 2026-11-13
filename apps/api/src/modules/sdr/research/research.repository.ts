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
import { and, asc, desc, eq } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Fetch dashboard KPI source tables and recent activity for an organization. */
export async function findDashboardDataset(organizationId: string) {
	const [
		allCompanies,
		pendingReviews,
		allThreads,
		upcomingMeetings,
		recentActivity,
	] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(withOrg(companies, organizationId))
			.orderBy(desc(companies.score)),
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
			.where(withOrg(threads, organizationId))
			.orderBy(desc(threads.lastMessageAt)),
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
			.limit(12),
	]);

	return {
		allCompanies,
		allThreads,
		pendingReviews,
		recentActivity,
		upcomingMeetings,
	};
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

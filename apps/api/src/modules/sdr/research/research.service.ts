import { logWarning } from "../../../lib/logger";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import { enqueueSdrPipelineJob } from "../queue";
import {
	createResearchRunRow,
	findDashboardDataset,
	findResearchRunsByOrg,
	updateResearchRunStatus,
} from "./research.repository";

/** Compute top-level SDR dashboard KPIs, pending reviews, and agent telemetry. */
export async function getDashboardSummary(organizationId: string) {
	await ensureSdrSettingsForOrg(organizationId);
	const {
		allCompanies,
		allThreads,
		pendingReviews,
		recentActivity,
		upcomingMeetings,
	} = await findDashboardDataset(organizationId);

	const researchedCount = allCompanies.length;
	const qualifiedCount = allCompanies.filter(
		(c) => c.tier === "A" || c.tier === "B"
	).length;
	const contactedCount = allCompanies.filter((c) =>
		["contacted", "replied", "meeting_booked", "suppressed"].includes(c.status)
	).length;
	const repliedCount = allCompanies.filter((c) =>
		["replied", "meeting_booked"].includes(c.status)
	).length;
	const bookedCount = upcomingMeetings.filter(
		(m) => m.status === "scheduled" || m.status === "completed"
	).length;
	const needsHumanThreads = allThreads.filter(
		(t) => t.status === "needs_human"
	);

	return {
		kpis: {
			bookedCount,
			contactedCount,
			needsHumanCount: needsHumanThreads.length,
			pendingReviewCount: pendingReviews.length,
			qualifiedCount,
			repliedCount,
			researchedCount,
		},
		needsHumanThreads,
		pendingReviews,
		recentActivity,
		upcomingMeetings,
	};
}

/** Return recent research discovery runs for an organization. */
export async function listResearchRuns(organizationId: string) {
	return await findResearchRunsByOrg(organizationId);
}

/** Start a new prospect discovery batch and enqueue it onto the SDR pipeline worker. */
export async function startResearchRun(params: {
	organizationId: string;
	queries?: string[];
	targetCount: number;
	userId: string;
}) {
	const settings = await ensureSdrSettingsForOrg(params.organizationId);
	const querySet =
		params.queries && params.queries.length > 0
			? params.queries
			: settings.icp.targetChannels
					.slice(0, 5)
					.map((channel) => `US ${channel} brand ${settings.icp.geography}`);

	const created = await createResearchRunRow({
		organizationId: params.organizationId,
		querySet,
		startedBy: params.userId,
	});

	if (!created) {
		throw new Error("Failed to create research run record");
	}

	let queued = false;
	let run = created;
	try {
		await enqueueSdrPipelineJob({
			action: "discover-batch",
			organizationId: params.organizationId,
			researchRunId: created.id,
			startedByUserId: params.userId,
			targetCount: params.targetCount,
		});
		queued = true;
	} catch (error) {
		logWarning(
			"SDRResearchService:startResearchRun",
			"Redis queue unavailable; marking research run failed",
			{ error: String(error), researchRunId: created.id }
		);
		const failed = await updateResearchRunStatus(
			created.id,
			"failed",
			"Worker queue unavailable in local environment."
		);
		if (failed) {
			run = failed;
		}
	}

	return {
		queued,
		run,
	};
}

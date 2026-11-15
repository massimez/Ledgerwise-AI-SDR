import {
	buildDiscoveryQueryVariations,
	type DiscoveryNicheId,
} from "@workspace/ai-core";
import { env } from "../../../env";
import { logWarning } from "../../../lib/logger";
import type { SdrDiscoverySignalPreset } from "../../../lib/queues";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import { enqueueSdrPipelineJob } from "../queue";
import {
	createResearchRunRow,
	failStaleResearchRuns,
	findDashboardDataset,
	findResearchRunsByOrg,
	updateResearchRunStatus,
} from "./research.repository";

/** Compute top-level SDR dashboard KPIs, pending reviews, and agent telemetry. */
export async function getDashboardSummary(organizationId: string) {
	await ensureSdrSettingsForOrg(organizationId);
	return await findDashboardDataset(organizationId);
}

/** Return recent research discovery runs for an organization. */
export async function listResearchRuns(organizationId: string) {
	return await findResearchRunsByOrg(organizationId);
}

/** Start a new prospect discovery batch and enqueue it onto the SDR pipeline worker. */
export async function startResearchRun(params: {
	keyword?: string;
	limit?: number;
	niche?: DiscoveryNicheId;
	organizationId: string;
	queries?: string[];
	signalPreset?: SdrDiscoverySignalPreset;
	targetCount?: number;
	userId: string;
}) {
	await failStaleResearchRuns(params.organizationId);
	const settings = await ensureSdrSettingsForOrg(params.organizationId);
	const normalizedKeyword = params.keyword?.trim() || undefined;
	const targetCount = params.signalPreset
		? Math.min(10, Math.max(1, params.limit ?? params.targetCount ?? 5))
		: (params.limit ?? params.targetCount ?? 5);

	let querySet: string[];
	if (params.queries && params.queries.length > 0) {
		querySet = params.queries;
	} else if (params.signalPreset) {
		const recentRuns = await findResearchRunsByOrg(params.organizationId);
		const recentQueries = recentRuns.flatMap((recentRun) => recentRun.querySet);
		querySet = buildDiscoveryQueryVariations({
			keyword: normalizedKeyword,
			niche: params.niche,
			recentQueries,
			signalPreset: params.signalPreset,
		}).slice(0, 2);
	} else {
		querySet = settings.icp.targetChannels
			.slice(0, 5)
			.map((channel) => `US ${channel} brand ${settings.icp.geography}`);
	}

	const created = await createResearchRunRow({
		organizationId: params.organizationId,
		querySet,
		startedBy: params.userId,
	});

	if (!created) {
		throw new Error("Failed to create research run record");
	}

	let jobId: string | null = null;
	let queued = false;
	let run = created;
	try {
		const job = await enqueueSdrPipelineJob({
			action: "discover-batch",
			keyword: normalizedKeyword,
			niche: params.niche,
			organizationId: params.organizationId,
			queries: querySet,
			researchRunId: created.id,
			signalPreset: params.signalPreset,
			startedByUserId: params.userId,
			targetCount,
		});
		jobId = job.id ?? created.id;
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
		if (env.NODE_ENV === "production") {
			throw error;
		}
	}

	return {
		jobId,
		queued,
		run,
		status: run.status,
	};
}

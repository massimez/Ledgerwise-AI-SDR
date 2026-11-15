import { discoverProspectBatch } from "@workspace/ai-core";
import type { SdrPipelineJobData } from "@workspace/api/queues";
import { env } from "../../../env";
import { logError, logInfo, logWarning } from "../../../lib/logger";
import { enqueueSdrResearchCompanyFromWorker } from "../../../lib/sdr-queues";
import {
	insertDiscoveredCompanyWithContact,
	listExistingCompanyDomains,
	recordCompanyResearchError,
	updateResearchRunProgress,
} from "./pipeline.repository";
import { workerSdrPipelineLogger } from "./pipeline-logger";

async function recordFailedCompanyEnqueues(params: {
	enqueueResults: PromiseSettledResult<unknown>[];
	createdCompanyIds: string[];
	organizationId: string;
	researchRunId: string;
}): Promise<{ enqueuedCount: number; failedEnqueueIds: string[] }> {
	const failedItems: Array<{ companyId: string; message: string }> = [];
	let enqueuedCount = 0;

	for (const [index, result] of params.enqueueResults.entries()) {
		const companyId = params.createdCompanyIds[index];
		if (!companyId) {
			continue;
		}
		if (result.status === "fulfilled") {
			enqueuedCount += 1;
		} else {
			failedItems.push({
				companyId,
				message:
					result.reason instanceof Error
						? result.reason.message
						: "Failed to enqueue per-company research job.",
			});
		}
	}

	if (failedItems.length > 0) {
		await Promise.all(
			failedItems.map((item) =>
				recordCompanyResearchError(
					item.companyId,
					item.message,
					params.organizationId
				).catch((recordError) => {
					logWarning("SdrDiscovery", "Failed to record company enqueue error", {
						companyId: item.companyId,
						error:
							recordError instanceof Error
								? recordError.message
								: String(recordError),
					});
				})
			)
		);
	}

	return {
		enqueuedCount,
		failedEnqueueIds: failedItems.map((item) => item.companyId),
	};
}

/** Discover net-new US e-commerce candidates and fan out per-company research jobs. */
export async function handleDiscoverBatch(
	payload: Extract<SdrPipelineJobData, { action: "discover-batch" }>
): Promise<{ discoveredCount: number }> {
	await updateResearchRunProgress(payload.researchRunId, { status: "running" });

	try {
		const existingDomains = await listExistingCompanyDomains(
			payload.organizationId
		);
		logInfo("SdrDiscovery", "Starting discovery batch", {
			existingDomainsCount: existingDomains.size,
			keyword: payload.keyword ?? null,
			niche: payload.niche ?? null,
			organizationId: payload.organizationId,
			queries: payload.queries ?? null,
			researchRunId: payload.researchRunId,
			signalPreset: payload.signalPreset ?? null,
			targetCount: payload.targetCount,
		});

		const { candidates, summary } = await discoverProspectBatch({
			exaApiKey: env.EXA_API_KEY || undefined,
			existingDomains,
			googleApiKey:
				env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || undefined,
			keyword: payload.keyword,
			logger: workerSdrPipelineLogger,
			niche: payload.niche,
			openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
			queries: payload.queries,
			sdrGeminiModel: env.SDR_GEMINI_MODEL || undefined,
			sdrModelFast: env.SDR_MODEL_FAST,
			signalPreset: payload.signalPreset,
			targetCount: payload.targetCount,
		});

		const createdCompanyIds = (
			await Promise.all(
				candidates.map((candidate) =>
					insertDiscoveredCompanyWithContact(payload.organizationId, candidate)
				)
			)
		).filter((companyId): companyId is string => companyId !== null);

		const discoveredCount = createdCompanyIds.length;
		const dbConflictSkippedCount = Math.max(
			0,
			candidates.length - discoveredCount
		);
		const preFilteredBreakdown = {
			...summary.preFilteredBreakdown,
			duplicateDomain:
				summary.preFilteredBreakdown.duplicateDomain + dbConflictSkippedCount,
		};
		const preFilteredCount = summary.preFilteredCount + dbConflictSkippedCount;
		const { exaSuggestedCount } = summary;

		logInfo("SdrDiscovery", "Persisting discovery batch counts", {
			discoveredCount,
			exaSuggestedCount,
			preFilteredBreakdown,
			preFilteredCount,
			researchRunId: payload.researchRunId,
		});

		await updateResearchRunProgress(
			payload.researchRunId,
			discoveredCount === 0
				? {
						completedAt: new Date(),
						exaSuggestedCount,
						foundCount: 0,
						preFilteredBreakdown,
						preFilteredCount,
						status: "completed",
					}
				: {
						exaSuggestedCount,
						foundCount: discoveredCount,
						preFilteredBreakdown,
						preFilteredCount,
						status: "running",
					}
		);

		const enqueueResults = await Promise.allSettled(
			createdCompanyIds.map((companyId) =>
				enqueueSdrResearchCompanyFromWorker({
					action: "research-company",
					companyId,
					organizationId: payload.organizationId,
					researchRunId: payload.researchRunId,
				})
			)
		);

		const { enqueuedCount, failedEnqueueIds } =
			await recordFailedCompanyEnqueues({
				createdCompanyIds,
				enqueueResults,
				organizationId: payload.organizationId,
				researchRunId: payload.researchRunId,
			});

		if (failedEnqueueIds.length > 0) {
			logWarning("SdrDiscovery", "Partial failure enqueueing research jobs", {
				enqueuedCount,
				failedCount: failedEnqueueIds.length,
				failedEnqueueIds,
				researchRunId: payload.researchRunId,
			});

			if (enqueuedCount === 0) {
				throw new Error(
					`Failed to enqueue research jobs for all ${failedEnqueueIds.length} discovered companies.`
				);
			}

			await updateResearchRunProgress(payload.researchRunId, {
				foundCount: enqueuedCount,
				status: "running",
			});
		}

		logInfo("SdrDiscovery", "Enqueued per-company research jobs", {
			candidateCount: candidates.length,
			createdCompanyIds,
			discoveredCount,
			domains: candidates.map((c) => c.domain),
			enqueuedCount,
			researchRunId: payload.researchRunId,
		});

		return { discoveredCount: enqueuedCount };
	} catch (error) {
		logError("SdrDiscovery", error, {
			organizationId: payload.organizationId,
			researchRunId: payload.researchRunId,
		});
		await updateResearchRunProgress(payload.researchRunId, {
			completedAt: new Date(),
			error: error instanceof Error ? error.message : String(error),
			status: "failed",
		});
		throw error;
	}
}

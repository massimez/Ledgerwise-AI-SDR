import { discoverProspectCandidates } from "@workspace/ai-core";
import type { SdrPipelineJobData } from "@workspace/api/queues";
import { env } from "../../../env";
import { enqueueSdrResearchCompanyFromWorker } from "../../../lib/sdr-queues";
import {
	insertDiscoveredCompanyWithContact,
	listExistingCompanyDomains,
	updateResearchRunProgress,
} from "./pipeline.repository";

/** Discover net-new US e-commerce candidates and fan out per-company research jobs. */
export async function handleDiscoverBatch(
	payload: Extract<SdrPipelineJobData, { action: "discover-batch" }>
): Promise<{ discoveredCount: number }> {
	await updateResearchRunProgress(payload.researchRunId, { status: "running" });

	const existingDomains = await listExistingCompanyDomains(
		payload.organizationId
	);
	const candidates = await discoverProspectCandidates({
		exaApiKey: env.EXA_API_KEY || undefined,
		existingDomains,
		targetCount: payload.targetCount,
	});

	const createdFlags = await Promise.all(
		candidates.map(async (candidate) => {
			const companyId = await insertDiscoveredCompanyWithContact(
				payload.organizationId,
				candidate
			);
			if (!companyId) {
				return false;
			}
			await enqueueSdrResearchCompanyFromWorker({
				action: "research-company",
				companyId,
				organizationId: payload.organizationId,
				researchRunId: payload.researchRunId,
			});
			return true;
		})
	);

	const discoveredCount = createdFlags.filter(Boolean).length;
	await updateResearchRunProgress(payload.researchRunId, {
		completedAt: new Date(),
		foundCount: discoveredCount,
		status: "completed",
	});

	return { discoveredCount };
}

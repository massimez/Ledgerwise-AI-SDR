import {
	type SdrPipelineJobData,
	sdrPipelineJobDataSchema,
} from "@workspace/api/queues";
import { type Job, UnrecoverableError } from "bullmq";
import { handleDiscoverBatch } from "./discover-batch.handler";
import { handleRegenerateDraft } from "./regenerate-draft.handler";
import { handleResearchCompany } from "./research-company.handler";

/** Main BullMQ processor for SDR research, qualification, and draft regeneration. */
export function processSdrPipelineJob(
	job: Job<SdrPipelineJobData>
): Promise<unknown> {
	const parsed = sdrPipelineJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid SDR pipeline job payload: ${parsed.error.message}`
		);
	}

	const payload = parsed.data;
	switch (payload.action) {
		case "discover-batch":
			return handleDiscoverBatch(payload);
		case "research-company":
			return handleResearchCompany(payload);
		case "regenerate-draft":
			return handleRegenerateDraft(payload);
		default:
			throw new UnrecoverableError("Unsupported SDR pipeline action");
	}
}

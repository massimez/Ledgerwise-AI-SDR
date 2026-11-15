import type { SdrPipelineJobData } from "@workspace/api/queues";
import { UnrecoverableError } from "bullmq";
import { logWarning } from "../../../lib/logger";
import { createPendingReviewDraft } from "./draft-generator";
import { toVerifiedEvidenceCandidates } from "./pipeline.mappers";
import {
	clearCompanyThreadPendingJob,
	findCompanyForPipeline,
	loadRegenerateDraftContext,
} from "./pipeline.repository";

/** Regenerate a pending-review first-email draft using stored verified company evidence. */
export async function handleRegenerateDraft(
	payload: Extract<SdrPipelineJobData, { action: "regenerate-draft" }>,
	options?: { isFinalAttempt?: boolean }
): Promise<{ messageId: string | null }> {
	try {
		const company = await findCompanyForPipeline(
			payload.organizationId,
			payload.companyId
		);
		if (!company) {
			throw new UnrecoverableError(`Company ${payload.companyId} not found.`);
		}

		const { primaryContact, settings, verifiedRows } =
			await loadRegenerateDraftContext(payload.organizationId, company.id);

		const verifiedEvidence = toVerifiedEvidenceCandidates(
			company.name,
			verifiedRows
		);
		const messageId = await createPendingReviewDraft({
			companyId: company.id,
			companyName: company.name,
			contactId: primaryContact?.id ?? null,
			decisionSummary: "Regenerated first-email draft awaiting review.",
			evidence: verifiedEvidence,
			firstName: primaryContact?.fullName.split(" ")[0] ?? null,
			instruction: payload.instruction,
			organizationId: payload.organizationId,
			playbookPitch: settings?.playbook.companyDescription,
			targetMessageId: payload.messageId,
		});

		return { messageId };
	} catch (error) {
		if (error instanceof UnrecoverableError || options?.isFinalAttempt) {
			await clearCompanyThreadPendingJob(
				payload.organizationId,
				payload.companyId
			).catch((clearError) => {
				logWarning(
					"SdrPipeline:regenerateDraft",
					"Failed to clear pendingJobId after draft error",
					{
						companyId: payload.companyId,
						error:
							clearError instanceof Error
								? clearError.message
								: String(clearError),
					}
				);
			});
		}
		throw error;
	}
}

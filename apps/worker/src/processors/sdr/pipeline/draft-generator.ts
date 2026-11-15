import {
	generateVerifiedFirstEmail,
	type VerifiedEvidenceCandidate,
} from "@workspace/ai-core";
import { env } from "../../../env";
import { logWarning } from "../../../lib/logger";
import { notifyOrgSdrMembers } from "../notifications";
import {
	clearCompanyThreadPendingJob,
	persistPendingReviewDraft,
} from "./pipeline.repository";

/** Generate a verified <100-word first email draft, store it for approval, and notify reviewers. */
export async function createPendingReviewDraft(params: {
	companyId: string;
	companyName: string;
	contactId: string | null;
	decisionSummary: string;
	evidence: VerifiedEvidenceCandidate[];
	firstName: string | null;
	instruction?: string;
	organizationId: string;
	playbookPitch?: string;
	targetMessageId?: string;
	tierLabel?: string;
}): Promise<string | null> {
	const emailResult = await generateVerifiedFirstEmail({
		companyName: params.companyName,
		evidence: params.evidence,
		firstName: params.firstName,
		googleApiKey:
			env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || undefined,
		instruction: params.instruction,
		openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
		playbookPitch: params.playbookPitch,
		requireLlm: true,
		sdrGeminiModel: env.SDR_GEMINI_MODEL || undefined,
		sdrModelFast: env.SDR_MODEL_FAST,
		sdrModelSmart: env.SDR_MODEL_SMART,
	});

	if (!emailResult.factCheck.passed || emailResult.citations.length === 0) {
		logWarning(
			"SdrPipeline:draftGenerator",
			"Blocked unverified first email draft from entering review queue",
			{
				citationCount: emailResult.citations.length,
				companyId: params.companyId,
				factCheckPassed: emailResult.factCheck.passed,
				priceMentionDetected: emailResult.factCheck.priceMentionDetected,
				wordCount: emailResult.factCheck.wordCount,
			}
		);
		await clearCompanyThreadPendingJob(
			params.organizationId,
			params.companyId
		).catch((clearError) => {
			logWarning(
				"SdrPipeline:draftGenerator",
				"Failed to clear pendingJobId after blocked draft",
				{
					companyId: params.companyId,
					error:
						clearError instanceof Error
							? clearError.message
							: String(clearError),
				}
			);
		});
		return null;
	}

	const persisted = await persistPendingReviewDraft({
		companyId: params.companyId,
		contactId: params.contactId,
		decisionSummary: params.decisionSummary,
		emailResult,
		organizationId: params.organizationId,
		targetMessageId: params.targetMessageId,
	});

	if (!persisted?.messageId) {
		return null;
	}

	if (params.tierLabel) {
		await notifyOrgSdrMembers({
			content: params.decisionSummary,
			data: {
				companyId: params.companyId,
				messageId: persisted.messageId,
				threadId: persisted.threadId,
			},
			idempotencyKey: `first-draft-${params.companyId}-${persisted.messageId}`,
			organizationId: params.organizationId,
			title: `First draft ready: ${params.companyName} (${params.tierLabel})`,
			type: "sdr_review_ready",
		});
	}

	return persisted.messageId;
}

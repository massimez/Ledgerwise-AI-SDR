import {
	generateVerifiedFirstEmail,
	type VerifiedEvidenceCandidate,
} from "@workspace/ai-core";
import { env } from "../../../env";
import { notifyOrgSdrMembers } from "../notifications";
import { persistPendingReviewDraft } from "./pipeline.repository";

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
	tierLabel?: string;
}): Promise<string | null> {
	const emailResult = await generateVerifiedFirstEmail({
		companyName: params.companyName,
		evidence: params.evidence,
		firstName: params.firstName,
		instruction: params.instruction,
		openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
		playbookPitch: params.playbookPitch,
		sdrModelFast: env.SDR_MODEL_FAST,
		sdrModelSmart: env.SDR_MODEL_SMART,
	});

	const persisted = await persistPendingReviewDraft({
		companyId: params.companyId,
		contactId: params.contactId,
		decisionSummary: params.decisionSummary,
		emailResult,
		organizationId: params.organizationId,
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

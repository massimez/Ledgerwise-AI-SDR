import {
	gatherCompanyResearchDocuments,
	runCompanyResearchPipeline,
} from "@workspace/ai-core";
import type { SdrPipelineJobData } from "@workspace/api/queues";
import { UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { logInfo } from "../../../lib/logger";
import { createPendingReviewDraft } from "./draft-generator";
import {
	findCompanyForPipeline,
	loadResearchCompanyContext,
	persistCompanyQualificationResult,
	persistCriteriaRows,
	persistResearchEvidence,
} from "./pipeline.repository";

/** Research a prospect domain, score ICP rubric, and stage a verified first-email draft. */
export async function handleResearchCompany(
	payload: Extract<SdrPipelineJobData, { action: "research-company" }>
): Promise<{
	draftCreated: boolean;
	score: number;
	tier: string;
}> {
	const company = await findCompanyForPipeline(
		payload.organizationId,
		payload.companyId
	);
	if (!company) {
		throw new UnrecoverableError(`Company ${payload.companyId} not found.`);
	}

	const [{ existingContacts, settings }, docs] = await Promise.all([
		loadResearchCompanyContext(payload.organizationId, company.id),
		gatherCompanyResearchDocuments({
			companyName: company.name,
			domain: company.domain,
			exaApiKey: env.EXA_API_KEY || undefined,
		}),
	]);

	const pipeline = await runCompanyResearchPipeline({
		companyName: company.name,
		docs,
		domain: company.domain,
		hasDecisionMaker: existingContacts.length > 0,
		icpConfig: settings?.icp,
		openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
		sdrModelFast: env.SDR_MODEL_FAST,
	});

	const persistedEvidence = await persistResearchEvidence({
		companyId: company.id,
		items: pipeline.evidence,
		organizationId: payload.organizationId,
	});

	await persistCriteriaRows({
		companyId: company.id,
		evidenceIds: persistedEvidence.slice(0, 2).map((item) => item.id),
		organizationId: payload.organizationId,
		rubric: pipeline.rubric,
	});

	const primaryContact = await persistCompanyQualificationResult({
		companyId: company.id,
		existingChannels: company.channels,
		existingHqLocation: company.hqLocation,
		existingPrimaryContact: existingContacts[0],
		organizationId: payload.organizationId,
		pipeline,
	});

	const shouldDraft =
		pipeline.rubric.tier !== "DQ" &&
		(pipeline.rubric.tier === "A" || pipeline.rubric.tier === "B") &&
		persistedEvidence.length > 0;

	let draftCreated = false;
	if (shouldDraft) {
		const draftId = await createPendingReviewDraft({
			companyId: company.id,
			companyName: company.name,
			contactId: primaryContact?.id ?? null,
			decisionSummary: `Tier ${pipeline.rubric.tier} (${pipeline.rubric.score}/100) awaiting mandatory first-email approval.`,
			evidence: persistedEvidence,
			firstName: primaryContact?.fullName.split(" ")[0] ?? null,
			organizationId: payload.organizationId,
			playbookPitch: settings?.playbook.companyDescription,
			tierLabel: `Tier ${pipeline.rubric.tier}`,
		});
		draftCreated = draftId !== null;
	}

	logInfo("SdrPipeline", "Completed company research + qualification", {
		companyId: company.id,
		draftCreated,
		score: pipeline.rubric.score,
		tier: pipeline.rubric.tier,
	});

	return {
		draftCreated,
		score: pipeline.rubric.score,
		tier: pipeline.rubric.tier,
	};
}

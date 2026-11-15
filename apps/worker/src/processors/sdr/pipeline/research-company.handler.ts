import {
	gatherCompanyResearchDocuments,
	hasQualifiedDecisionMakerContact,
	isGenericMailboxEmail,
	type RawSourceDocument,
	runCompanyResearchPipeline,
} from "@workspace/ai-core";
import type { SdrPipelineJobData } from "@workspace/api/queues";
import { UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { logError, logInfo, logWarning } from "../../../lib/logger";
import { createPendingReviewDraft } from "./draft-generator";
import { mapDbEvidenceKindToSourceType } from "./pipeline.mappers";
import {
	findCompanyForPipeline,
	loadCachedCompanySourceDocs,
	loadResearchCompanyContext,
	persistCompanyQualificationResult,
	persistCompanySourceDocs,
	persistCriteriaRows,
	persistResearchEvidence,
	recordCompanyResearchError,
	recordResearchRunCompanyOutcome,
	updateResearchRunProgress,
} from "./pipeline.repository";
import { workerSdrPipelineLogger } from "./pipeline-logger";

export interface ResearchCompanyDeps {
	createPendingReviewDraft: typeof createPendingReviewDraft;
	findCompanyForPipeline: typeof findCompanyForPipeline;
	gatherCompanyResearchDocuments: typeof gatherCompanyResearchDocuments;
	loadCachedCompanySourceDocs: typeof loadCachedCompanySourceDocs;
	loadResearchCompanyContext: typeof loadResearchCompanyContext;
	persistCompanyQualificationResult: typeof persistCompanyQualificationResult;
	persistCompanySourceDocs: typeof persistCompanySourceDocs;
	persistCriteriaRows: typeof persistCriteriaRows;
	persistResearchEvidence: typeof persistResearchEvidence;
	recordCompanyResearchError: typeof recordCompanyResearchError;
	recordResearchRunCompanyOutcome: typeof recordResearchRunCompanyOutcome;
	runCompanyResearchPipeline: typeof runCompanyResearchPipeline;
	updateResearchRunProgress: typeof updateResearchRunProgress;
}

const DEFAULT_RESEARCH_COMPANY_DEPS: ResearchCompanyDeps = {
	createPendingReviewDraft,
	findCompanyForPipeline,
	gatherCompanyResearchDocuments,
	loadCachedCompanySourceDocs,
	loadResearchCompanyContext,
	persistCompanyQualificationResult,
	persistCompanySourceDocs,
	persistCriteriaRows,
	persistResearchEvidence,
	recordCompanyResearchError,
	recordResearchRunCompanyOutcome,
	runCompanyResearchPipeline,
	updateResearchRunProgress,
};

async function recordTerminalResearchFailure(params: {
	companyId: string;
	deps: Pick<
		ResearchCompanyDeps,
		"recordCompanyResearchError" | "recordResearchRunCompanyOutcome"
	>;
	error: unknown;
	isFinalAttempt: boolean;
	organizationId: string;
	researchRunId?: string;
}) {
	const isTerminal =
		params.error instanceof UnrecoverableError || params.isFinalAttempt;
	if (!isTerminal) {
		return;
	}
	const message =
		params.error instanceof Error ? params.error.message : String(params.error);

	await params.deps
		.recordCompanyResearchError(
			params.companyId,
			message,
			params.organizationId
		)
		.catch((recordError) => {
			logWarning(
				"SdrPipeline",
				"Failed to persist company research error state",
				{
					companyId: params.companyId,
					error:
						recordError instanceof Error
							? recordError.message
							: String(recordError),
				}
			);
		});
	if (params.researchRunId) {
		await params.deps
			.recordResearchRunCompanyOutcome({
				isQualified: false,
				researchRunId: params.researchRunId,
			})
			.catch((outcomeError) => {
				logWarning(
					"SdrPipeline",
					"Failed to update research run failure counters",
					{
						companyId: params.companyId,
						error:
							outcomeError instanceof Error
								? outcomeError.message
								: String(outcomeError),
						researchRunId: params.researchRunId,
					}
				);
			});
	}
}

async function loadOrGatherCompanySourceDocs(params: {
	companyId: string;
	companyName: string;
	deps: Pick<
		ResearchCompanyDeps,
		| "gatherCompanyResearchDocuments"
		| "loadCachedCompanySourceDocs"
		| "persistCompanySourceDocs"
	>;
	domain: string;
	organizationId: string;
}): Promise<{ gatheredDocs: RawSourceDocument[]; usedCachedDocs: boolean }> {
	const cachedDocs = await params.deps.loadCachedCompanySourceDocs(
		params.companyId
	);
	if (cachedDocs.length > 0) {
		logInfo("SdrPipeline", "Reusing persisted source documents (cache hit)", {
			cachedDocCount: cachedDocs.length,
			companyId: params.companyId,
			domain: params.domain,
		});
		return { gatheredDocs: cachedDocs, usedCachedDocs: true };
	}

	const freshDocs = await params.deps.gatherCompanyResearchDocuments({
		companyName: params.companyName,
		domain: params.domain,
		exaApiKey: env.EXA_API_KEY || undefined,
		logger: workerSdrPipelineLogger,
	});
	const gatheredDocs = await params.deps.persistCompanySourceDocs({
		companyId: params.companyId,
		docs: freshDocs,
		organizationId: params.organizationId,
	});
	logInfo(
		"SdrPipeline",
		"Persisted gathered source documents before LLM extraction",
		{
			companyId: params.companyId,
			domain: params.domain,
			persistedDocCount: gatheredDocs.length,
		}
	);
	return { gatheredDocs, usedCachedDocs: false };
}

function buildSeedEvidenceDocs(params: {
	companyName: string;
	existingEvidence: Awaited<
		ReturnType<typeof loadResearchCompanyContext>
	>["existingEvidence"];
	gatheredDocs: RawSourceDocument[];
}): RawSourceDocument[] {
	const gatheredUrls = new Set(params.gatheredDocs.map((doc) => doc.url));
	return params.existingEvidence
		.filter((row) => !gatheredUrls.has(row.url))
		.map((row) => ({
			fetchedAt: row.retrievedAt.toISOString(),
			sourceType: mapDbEvidenceKindToSourceType(row.kind),
			text: row.quote,
			title: row.title ?? params.companyName,
			url: row.url,
		}));
}

async function maybeCreateFirstDraft(params: {
	companyId: string;
	companyName: string;
	deps: Pick<ResearchCompanyDeps, "createPendingReviewDraft">;
	domain: string;
	isQualifiedTier: boolean;
	organizationId: string;
	persistedEvidence: Awaited<ReturnType<typeof persistResearchEvidence>>;
	playbookPitch?: string;
	primaryContact: Awaited<ReturnType<typeof persistCompanyQualificationResult>>;
	score: number;
	tier: string;
}): Promise<string | null> {
	const hasEvidence = params.persistedEvidence.length > 0;
	if (!(params.isQualifiedTier && hasEvidence)) {
		return null;
	}
	const hasContactEmail = Boolean(
		params.primaryContact?.email?.trim() &&
			!isGenericMailboxEmail(params.primaryContact.email)
	);
	if (!hasContactEmail) {
		logWarning(
			"SdrPipeline",
			"Skipping first-email draft: company qualified without a verified contact email",
			{
				companyId: params.companyId,
				companyName: params.companyName,
				domain: params.domain,
				persistedEvidenceCount: params.persistedEvidence.length,
				score: params.score,
				tier: params.tier,
			}
		);
		return null;
	}

	const decisionSummary =
		params.primaryContact?.emailStatus === "guessed"
			? `Tier ${params.tier} (${params.score}/100) — Pattern-derived contact email (${params.primaryContact.email}) flagged for human review before sending.`
			: `Tier ${params.tier} (${params.score}/100) awaiting mandatory first-email approval.`;

	return await params.deps.createPendingReviewDraft({
		companyId: params.companyId,
		companyName: params.companyName,
		contactId: params.primaryContact?.id ?? null,
		decisionSummary,
		evidence: params.persistedEvidence,
		firstName: params.primaryContact?.fullName.split(" ")[0] ?? null,
		organizationId: params.organizationId,
		playbookPitch: params.playbookPitch,
		tierLabel: `Tier ${params.tier}`,
	});
}

/** Research a prospect domain, score ICP rubric, and stage a verified first-email draft. */
export async function handleResearchCompany(
	payload: Extract<SdrPipelineJobData, { action: "research-company" }>,
	options?: {
		deps?: Partial<ResearchCompanyDeps>;
		isFinalAttempt?: boolean;
	}
): Promise<{
	draftCreated: boolean;
	score: number;
	tier: string;
}> {
	const deps: ResearchCompanyDeps = {
		...DEFAULT_RESEARCH_COMPANY_DEPS,
		...options?.deps,
	};

	try {
		const company = await deps.findCompanyForPipeline(
			payload.organizationId,
			payload.companyId
		);
		if (!company) {
			throw new UnrecoverableError(`Company ${payload.companyId} not found.`);
		}
		logInfo("SdrPipeline", "Starting company research + qualification", {
			companyId: company.id,
			companyName: company.name,
			domain: company.domain,
			organizationId: payload.organizationId,
			researchRunId: payload.researchRunId ?? null,
		});

		const [
			{ existingContacts, existingEvidence, settings },
			{ gatheredDocs, usedCachedDocs },
		] = await Promise.all([
			deps.loadResearchCompanyContext(payload.organizationId, company.id),
			loadOrGatherCompanySourceDocs({
				companyId: company.id,
				companyName: company.name,
				deps,
				domain: company.domain,
				organizationId: payload.organizationId,
			}),
		]);

		const seedEvidenceDocs = buildSeedEvidenceDocs({
			companyName: company.name,
			existingEvidence,
			gatheredDocs,
		});
		const docs = [...seedEvidenceDocs, ...gatheredDocs];

		logInfo("SdrPipeline", "Loaded company context and research sources", {
			companyId: company.id,
			docCount: docs.length,
			domain: company.domain,
			existingContactEmails: existingContacts
				.map((c) => c.email)
				.filter(Boolean),
			existingContactsCount: existingContacts.length,
			seedEvidenceDocsCount: seedEvidenceDocs.length,
			usedCachedDocs,
		});

		const pipeline = await deps.runCompanyResearchPipeline({
			companyName: company.name,
			docs,
			domain: company.domain,
			googleApiKey:
				env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || undefined,
			hasDecisionMaker: existingContacts.some((contact) =>
				hasQualifiedDecisionMakerContact(contact)
			),
			icpConfig: settings?.icp,
			logger: workerSdrPipelineLogger,
			openrouterApiKey: env.OPENROUTER_API_KEY || undefined,
			requireLlm: true,
			sdrGeminiModel: env.SDR_GEMINI_MODEL || undefined,
			sdrModelFast: env.SDR_MODEL_FAST,
		});

		const persistedEvidence = await deps.persistResearchEvidence({
			companyId: company.id,
			existingRows: existingEvidence,
			items: pipeline.evidence,
			organizationId: payload.organizationId,
		});

		await deps.persistCriteriaRows({
			companyId: company.id,
			evidenceIds: persistedEvidence.slice(0, 2).map((item) => item.id),
			organizationId: payload.organizationId,
			rubric: pipeline.rubric,
		});

		const primaryContact = await deps.persistCompanyQualificationResult({
			companyId: company.id,
			existingChannels: company.channels,
			existingHqLocation: company.hqLocation,
			existingPrimaryContact: existingContacts[0],
			organizationId: payload.organizationId,
			pipeline,
		});

		const isQualifiedTier =
			pipeline.rubric.tier === "A" || pipeline.rubric.tier === "B";
		const draftMessageId = await maybeCreateFirstDraft({
			companyId: company.id,
			companyName: company.name,
			deps,
			domain: company.domain,
			isQualifiedTier,
			organizationId: payload.organizationId,
			persistedEvidence,
			playbookPitch: settings?.playbook.companyDescription,
			primaryContact,
			score: pipeline.rubric.score,
			tier: pipeline.rubric.tier,
		});
		const draftCreated = draftMessageId !== null;

		if (payload.researchRunId) {
			await deps.recordResearchRunCompanyOutcome({
				isQualified: isQualifiedTier,
				researchRunId: payload.researchRunId,
			});
		}

		logInfo("SdrPipeline", "Completed company research + qualification", {
			companyId: company.id,
			disqualificationReason: pipeline.rubric.disqualificationReason,
			domain: company.domain,
			draftCreated,
			draftMessageId,
			persistedEvidenceCount: persistedEvidence.length,
			primaryContactEmail: primaryContact?.email ?? null,
			primaryContactId: primaryContact?.id ?? null,
			score: pipeline.rubric.score,
			signals: pipeline.signals,
			tier: pipeline.rubric.tier,
		});

		return {
			draftCreated,
			score: pipeline.rubric.score,
			tier: pipeline.rubric.tier,
		};
	} catch (error) {
		logError("SdrPipeline", error, {
			companyId: payload.companyId,
			isFinalAttempt: options?.isFinalAttempt ?? true,
			researchRunId: payload.researchRunId ?? null,
		});
		await recordTerminalResearchFailure({
			companyId: payload.companyId,
			deps,
			error,
			isFinalAttempt: options?.isFinalAttempt ?? true,
			organizationId: payload.organizationId,
			researchRunId: payload.researchRunId,
		});
		throw error;
	}
}

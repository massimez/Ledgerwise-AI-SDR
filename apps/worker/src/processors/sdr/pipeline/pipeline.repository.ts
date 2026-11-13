import type {
	CompanyResearchPipelineResult,
	DiscoveredProspectCandidate,
	VerifiedEvidenceCandidate,
	VerifiedFirstEmailPipelineResult,
} from "@workspace/ai-core";
import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	contacts,
	evidence,
	messages,
	qualificationCriteria,
	researchRuns,
	sdrSettings,
	threads,
} from "@workspace/db/schema/sdr";
import { and, eq } from "drizzle-orm";
import {
	inferPersona,
	mapEvidenceKind,
	mapFitVerdict,
} from "./pipeline.mappers";

/** Mark a discovery research run status cleanly. */
export async function updateResearchRunProgress(
	runId: string,
	patch: {
		completedAt?: Date;
		foundCount?: number;
		status: "running" | "completed";
	}
) {
	await db.update(researchRuns).set(patch).where(eq(researchRuns.id, runId));
}

/** Load existing company domains for duplicate filtering in discovery. */
export async function listExistingCompanyDomains(organizationId: string) {
	const rows = await db
		.select({ domain: companies.domain })
		.from(companies)
		.where(eq(companies.organizationId, organizationId));

	return new Set(rows.map((row) => row.domain));
}

/** Insert a discovered company and optional primary contact, returning the new company ID if created. */
export async function insertDiscoveredCompanyWithContact(
	organizationId: string,
	candidate: DiscoveredProspectCandidate
): Promise<string | null> {
	const [inserted] = await db
		.insert(companies)
		.values({
			channels: candidate.channels,
			domain: candidate.domain,
			hqLocation: candidate.location ?? null,
			name: candidate.name,
			organizationId,
			status: "discovered",
			website: `https://${candidate.domain}`,
		})
		.onConflictDoNothing()
		.returning({ id: companies.id });

	if (!inserted) {
		return null;
	}

	if (candidate.contactFirstName || candidate.contactEmail) {
		const fullName =
			`${candidate.contactFirstName ?? ""} ${candidate.contactLastName ?? ""}`.trim() ||
			"Finance Lead";
		await db.insert(contacts).values({
			companyId: inserted.id,
			email: candidate.contactEmail ?? null,
			emailStatus: candidate.contactEmail ? "guessed" : "unknown",
			fullName,
			organizationId,
			persona: inferPersona(candidate.contactRole),
			title: candidate.contactRole ?? "Head of Finance",
		});
	}

	return inserted.id;
}

/** Find a company scoped to an organization. */
export async function findCompanyForPipeline(
	organizationId: string,
	companyId: string
) {
	const [company] = await db
		.select()
		.from(companies)
		.where(
			and(
				eq(companies.id, companyId),
				eq(companies.organizationId, organizationId)
			)
		)
		.limit(1);

	return company ?? null;
}

/** Mark company status as `researching` and load contacts + SDR settings. */
export async function loadResearchCompanyContext(
	organizationId: string,
	companyId: string
) {
	await db
		.update(companies)
		.set({ status: "researching" })
		.where(eq(companies.id, companyId));

	const [existingContacts, [settings]] = await Promise.all([
		db.select().from(contacts).where(eq(contacts.companyId, companyId)),
		db
			.select()
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
	]);

	return { existingContacts, settings };
}

/** Insert verified evidence rows and return candidates hydrated with persisted DB IDs. */
export async function persistResearchEvidence(params: {
	companyId: string;
	items: VerifiedEvidenceCandidate[];
	organizationId: string;
}): Promise<VerifiedEvidenceCandidate[]> {
	if (params.items.length === 0) {
		return [];
	}

	const insertedEvidence = await db
		.insert(evidence)
		.values(
			params.items.map((item) => ({
				claim: item.claim,
				companyId: params.companyId,
				kind: mapEvidenceKind(item.sourceType),
				organizationId: params.organizationId,
				quote: item.quote,
				title: item.sourceTitle,
				url: item.url,
				verificationMethod: "exact" as const,
				verified: item.verified,
			}))
		)
		.returning();

	const persisted: VerifiedEvidenceCandidate[] = [];
	for (const [index, row] of insertedEvidence.entries()) {
		const original = params.items[index];
		if (original) {
			persisted.push({ ...original, id: row.id });
		}
	}
	return persisted;
}

/** Upsert all five core ICP qualification rubric criteria rows for a company. */
export async function persistCriteriaRows(params: {
	companyId: string;
	evidenceIds: string[];
	organizationId: string;
	rubric: CompanyResearchPipelineResult["rubric"];
}): Promise<void> {
	const { breakdown } = params.rubric;
	const rows = [
		{
			criterion: "us_based" as const,
			maxPoints: breakdown.usBased.maxPoints,
			points: breakdown.usBased.points,
			rationale: breakdown.usBased.label,
			verdict: mapFitVerdict(breakdown.usBased.status),
		},
		{
			criterion: "ecommerce_brand" as const,
			maxPoints: breakdown.ecommerceBrand.maxPoints,
			points: breakdown.ecommerceBrand.points,
			rationale: breakdown.ecommerceBrand.label,
			verdict: mapFitVerdict(breakdown.ecommerceBrand.status),
		},
		{
			criterion: "revenue_1m_10m" as const,
			maxPoints: breakdown.revenueFit.maxPoints,
			points: breakdown.revenueFit.points,
			rationale: breakdown.revenueFit.label,
			verdict: mapFitVerdict(breakdown.revenueFit.status),
		},
		{
			criterion: "employees_5_50" as const,
			maxPoints: breakdown.employeesFit.maxPoints,
			points: breakdown.employeesFit.points,
			rationale: breakdown.employeesFit.label,
			verdict: mapFitVerdict(breakdown.employeesFit.status),
		},
		{
			criterion: "decision_maker_found" as const,
			maxPoints: breakdown.decisionMakerFit.maxPoints,
			points: breakdown.decisionMakerFit.points,
			rationale: breakdown.decisionMakerFit.label,
			verdict: mapFitVerdict(breakdown.decisionMakerFit.status),
		},
	];

	await Promise.all(
		rows.map((row) =>
			db
				.insert(qualificationCriteria)
				.values({
					companyId: params.companyId,
					evidenceIds: params.evidenceIds,
					organizationId: params.organizationId,
					...row,
				})
				.onConflictDoUpdate({
					set: {
						maxPoints: row.maxPoints,
						points: row.points,
						rationale: row.rationale,
						verdict: row.verdict,
					},
					target: [
						qualificationCriteria.companyId,
						qualificationCriteria.criterion,
					],
				})
		)
	);
}

/** Update company qualification score, tier, signals, summary, and optionally insert extracted contact. */
export async function persistCompanyQualificationResult(params: {
	companyId: string;
	existingChannels: string[];
	existingHqLocation: string | null;
	existingPrimaryContact: typeof contacts.$inferSelect | undefined;
	organizationId: string;
	pipeline: CompanyResearchPipelineResult;
}) {
	const isQualified = params.pipeline.rubric.tier !== "DQ";

	await db
		.update(companies)
		.set({
			channels:
				params.pipeline.channels.length > 0
					? params.pipeline.channels
					: params.existingChannels,
			disqualifyReason: params.pipeline.rubric.disqualificationReason,
			hqLocation: params.pipeline.location ?? params.existingHqLocation,
			lastResearchedAt: new Date(),
			score: params.pipeline.rubric.score,
			signals: params.pipeline.signals,
			status: isQualified ? "qualified" : "disqualified",
			summary: params.pipeline.summary,
			tier: params.pipeline.rubric.tier,
		})
		.where(eq(companies.id, params.companyId));

	if (params.existingPrimaryContact || !params.pipeline.contact?.email) {
		return params.existingPrimaryContact;
	}

	const [insertedContact] = await db
		.insert(contacts)
		.values({
			companyId: params.companyId,
			email: params.pipeline.contact.email,
			emailStatus: "guessed",
			fullName:
				`${params.pipeline.contact.firstName ?? ""} ${params.pipeline.contact.lastName ?? ""}`.trim() ||
				"Finance Lead",
			organizationId: params.organizationId,
			persona: inferPersona(params.pipeline.contact.role),
			title: params.pipeline.contact.role ?? "Head of Finance",
		})
		.returning();

	return insertedContact;
}

/** Load verified evidence, primary contact, and SDR settings for draft regeneration. */
export async function loadRegenerateDraftContext(
	organizationId: string,
	companyId: string
) {
	const [verifiedRows, [primaryContact], [settings]] = await Promise.all([
		db
			.select()
			.from(evidence)
			.where(
				and(eq(evidence.companyId, companyId), eq(evidence.verified, true))
			),
		db
			.select()
			.from(contacts)
			.where(eq(contacts.companyId, companyId))
			.limit(1),
		db
			.select()
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
	]);

	return { primaryContact, settings, verifiedRows };
}

/** Ensure an SDR thread exists for a company, insert a pending-review draft, and log agent runs. */
export async function persistPendingReviewDraft(params: {
	companyId: string;
	contactId: string | null;
	decisionSummary: string;
	emailResult: VerifiedFirstEmailPipelineResult;
	organizationId: string;
}) {
	const [existingThread] = await db
		.select()
		.from(threads)
		.where(eq(threads.companyId, params.companyId))
		.limit(1);

	let threadId = existingThread?.id;
	if (!threadId) {
		const [createdThread] = await db
			.insert(threads)
			.values({
				aiMode: "auto",
				companyId: params.companyId,
				contactId: params.contactId,
				organizationId: params.organizationId,
				replyToken: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
				status: "awaiting_review",
			})
			.returning({ id: threads.id });
		threadId = createdThread?.id;
	}

	if (!threadId) {
		return null;
	}

	const [draftMsg] = await db
		.insert(messages)
		.values({
			aiOriginalBody: params.emailResult.body,
			author: "ai",
			bodyText: params.emailResult.body,
			citations: params.emailResult.citations,
			decisionSummary: params.decisionSummary,
			direction: "outbound",
			factCheck: params.emailResult.factCheck,
			organizationId: params.organizationId,
			status: "pending_review",
			subject: params.emailResult.subject,
			threadId,
		})
		.returning({ id: messages.id });

	await Promise.all([
		db
			.update(companies)
			.set({ status: "drafted" })
			.where(eq(companies.id, params.companyId)),
		db
			.update(threads)
			.set({ pendingJobId: null, status: "awaiting_review" })
			.where(eq(threads.id, threadId)),
	]);

	if (params.emailResult.telemetry.length > 0) {
		await db.insert(agentRuns).values(
			params.emailResult.telemetry.map((run) => ({
				companyId: params.companyId,
				decision: params.emailResult.guardResult.passed
					? "pending_review"
					: "flagged",
				guardResults: params.emailResult.guardResult,
				inputTokens: run.tokensIn,
				latencyMs: run.latencyMs,
				messageId: draftMsg?.id ?? null,
				model: run.model,
				organizationId: params.organizationId,
				output: { summary: run.outputSummary },
				outputTokens: run.tokensOut,
				step: (run.agentName === "fact_check_judge" ? "factcheck" : "write") as
					| "factcheck"
					| "write",
				threadId,
			}))
		);
	}

	return { messageId: draftMsg?.id ?? null, threadId };
}

import {
	type CompanyResearchPipelineResult,
	type DiscoveredProspectCandidate,
	hasQualifiedDecisionMakerContact,
	isGenericMailboxEmail,
	isThirdPartySignalHost,
	type RawSourceDocument,
	type VerifiedEvidenceCandidate,
	type VerifiedFirstEmailPipelineResult,
	verifyQuoteAgainstSource,
} from "@workspace/ai-core";
import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	companySourceDocs,
	contacts,
	type DiscoveryPreFilteredBreakdown,
	evidence,
	messages,
	qualificationCriteria,
	researchRuns,
	sdrSettings,
	threads,
} from "@workspace/db/schema/sdr";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
	inferPersona,
	mapEvidenceKind,
	mapFitVerdict,
	toVerifiedEvidenceCandidates,
} from "./pipeline.mappers";

/** Mark a discovery research run status cleanly. */
export async function updateResearchRunProgress(
	runId: string,
	patch: {
		completedAt?: Date;
		error?: string | null;
		exaSuggestedCount?: number;
		foundCount?: number;
		preFilteredBreakdown?: DiscoveryPreFilteredBreakdown;
		preFilteredCount?: number;
		status: "running" | "completed" | "failed";
	}
) {
	await db.update(researchRuns).set(patch).where(eq(researchRuns.id, runId));
}

/** Record a terminal research failure message on a company row if still in research state. */
export async function recordCompanyResearchError(
	companyId: string,
	errorMessage: string,
	organizationId?: string
) {
	await db
		.update(companies)
		.set({
			researchError: errorMessage.slice(0, 1000),
			status: "disqualified",
		})
		.where(
			and(
				eq(companies.id, companyId),
				...(organizationId
					? [eq(companies.organizationId, organizationId)]
					: []),
				inArray(companies.status, ["discovered", "researching"])
			)
		);
}

/** Increment researched/qualified counters for a run and complete it once all found companies finish. */
export async function recordResearchRunCompanyOutcome(params: {
	isQualified: boolean;
	researchRunId: string;
}) {
	const [updated] = await db
		.update(researchRuns)
		.set({
			qualifiedCount: params.isQualified
				? sql`${researchRuns.qualifiedCount} + 1`
				: researchRuns.qualifiedCount,
			researchedCount: sql`${researchRuns.researchedCount} + 1`,
		})
		.where(eq(researchRuns.id, params.researchRunId))
		.returning();

	if (
		updated &&
		updated.foundCount > 0 &&
		updated.researchedCount >= updated.foundCount &&
		updated.status === "running"
	) {
		await db
			.update(researchRuns)
			.set({
				completedAt: new Date(),
				status: "completed",
			})
			.where(
				and(
					eq(researchRuns.id, params.researchRunId),
					eq(researchRuns.status, "running")
				)
			);
	}
}

/** Load existing company domains for duplicate filtering in discovery. */
export async function listExistingCompanyDomains(organizationId: string) {
	const rows = await db
		.select({ domain: companies.domain })
		.from(companies)
		.where(eq(companies.organizationId, organizationId));

	return new Set(rows.map((row) => row.domain));
}

function inferDiscoveryEvidenceKind(
	url: string,
	quote: string
): "job_posting" | "funding" | "website" {
	const lowerUrl = url.toLowerCase();
	const lowerQuote = quote.toLowerCase();
	const hasHiringCue =
		lowerQuote.includes("hiring") ||
		lowerQuote.includes("seeking") ||
		lowerQuote.includes("apply now") ||
		lowerQuote.includes("job opening") ||
		lowerQuote.includes("careers");
	const hasFinanceRole =
		lowerQuote.includes("accountant") ||
		lowerQuote.includes("controller") ||
		lowerQuote.includes("bookkeeper") ||
		lowerQuote.includes("finance manager");
	if (
		isThirdPartySignalHost(url) ||
		lowerUrl.includes("/careers") ||
		lowerUrl.includes("/jobs") ||
		(hasHiringCue && hasFinanceRole)
	) {
		return "job_posting";
	}
	if (
		lowerQuote.includes("raised ") ||
		lowerQuote.includes("seed round") ||
		lowerQuote.includes("series ") ||
		lowerQuote.includes("funding")
	) {
		return "funding";
	}
	return "website";
}

type PipelineTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertDiscoveryEvidence(
	tx: PipelineTx,
	params: {
		candidate: DiscoveredProspectCandidate;
		companyId: string;
		organizationId: string;
	}
) {
	const discoverySeed = params.candidate.seedDocuments?.[0];
	const evidenceUrl = params.candidate.evidenceUrl ?? discoverySeed?.url;
	const rawEvidenceQuote =
		params.candidate.evidenceQuote ?? discoverySeed?.text.trim().slice(0, 320);

	if (!(evidenceUrl && rawEvidenceQuote && rawEvidenceQuote.length >= 12)) {
		return;
	}

	const quote =
		discoverySeed &&
		!verifyQuoteAgainstSource(rawEvidenceQuote, discoverySeed.text)
			? discoverySeed.text.trim().slice(0, 320)
			: rawEvidenceQuote.slice(0, 500);

	await tx.insert(evidence).values({
		claim: `${params.candidate.name} was discovered from a qualifying signal on ${evidenceUrl}.`,
		companyId: params.companyId,
		kind: inferDiscoveryEvidenceKind(evidenceUrl, quote),
		organizationId: params.organizationId,
		quote,
		title: discoverySeed?.title ?? params.candidate.name,
		url: evidenceUrl,
		verificationMethod: "exact",
		verified: true,
	});
}

async function insertDiscoveryContact(
	tx: PipelineTx,
	params: {
		candidate: DiscoveredProspectCandidate;
		companyId: string;
		organizationId: string;
	}
) {
	if (!(params.candidate.contactFirstName || params.candidate.contactEmail)) {
		return;
	}

	const fullName =
		`${params.candidate.contactFirstName ?? ""} ${params.candidate.contactLastName ?? ""}`.trim() ||
		"Finance Lead";
	await tx.insert(contacts).values({
		companyId: params.companyId,
		email: params.candidate.contactEmail ?? null,
		emailStatus: params.candidate.contactEmail ? "guessed" : "unknown",
		fullName,
		organizationId: params.organizationId,
		persona: inferPersona(params.candidate.contactRole),
		title: params.candidate.contactRole ?? "Head of Finance",
	});
}

/** Insert a discovered company, discovery qualification evidence, and optional contact. */
export async function insertDiscoveredCompanyWithContact(
	organizationId: string,
	candidate: DiscoveredProspectCandidate
): Promise<string | null> {
	return await db.transaction(async (tx) => {
		const [inserted] = await tx
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

		await insertDiscoveryEvidence(tx, {
			candidate,
			companyId: inserted.id,
			organizationId,
		});
		await insertDiscoveryContact(tx, {
			candidate,
			companyId: inserted.id,
			organizationId,
		});

		return inserted.id;
	});
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

/** Mark unstarted company status as `researching` and load contacts, existing evidence, and SDR settings. */
export async function loadResearchCompanyContext(
	organizationId: string,
	companyId: string
) {
	await db
		.update(companies)
		.set({ status: "researching" })
		.where(
			and(
				eq(companies.id, companyId),
				eq(companies.organizationId, organizationId),
				inArray(companies.status, ["discovered", "researching"])
			)
		);

	const [existingContacts, existingEvidence, [settings]] = await Promise.all([
		db
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.companyId, companyId),
					eq(contacts.organizationId, organizationId)
				)
			)
			.orderBy(asc(contacts.createdAt)),
		db
			.select()
			.from(evidence)
			.where(
				and(
					eq(evidence.companyId, companyId),
					eq(evidence.organizationId, organizationId),
					eq(evidence.verified, true)
				)
			)
			.orderBy(desc(evidence.publishedAt)),
		db
			.select()
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
	]);

	return { existingContacts, existingEvidence, settings };
}

export const SOURCE_DOC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function parseSafeFetchedAt(iso: string): Date {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Deduplicate gathered source documents by URL, keeping the longest text per URL. */
export function deduplicateSourceDocuments(
	docs: RawSourceDocument[]
): RawSourceDocument[] {
	const byUrl = new Map<string, RawSourceDocument>();
	for (const doc of docs) {
		const url = doc.url.trim();
		if (!url) {
			continue;
		}
		const existing = byUrl.get(url);
		if (!existing || doc.text.length > existing.text.length) {
			byUrl.set(url, { ...doc, url });
		}
	}
	return Array.from(byUrl.values());
}

/** Load cached source documents for a company when gathered within `maxAgeMs`. */
export async function loadCachedCompanySourceDocs(
	companyId: string,
	maxAgeMs = SOURCE_DOC_CACHE_TTL_MS
): Promise<RawSourceDocument[]> {
	const rows = await db
		.select()
		.from(companySourceDocs)
		.where(eq(companySourceDocs.companyId, companyId));

	if (rows.length === 0) {
		return [];
	}

	const freshestMs = Math.max(...rows.map((row) => row.fetchedAt.getTime()));
	if (Date.now() - freshestMs > maxAgeMs) {
		return [];
	}

	return rows.map((row) => ({
		fetchedAt: row.fetchedAt.toISOString(),
		sourceType: row.sourceType,
		text: row.text,
		title: row.title,
		url: row.url,
	}));
}

/** Replace and persist gathered source documents for a company before LLM extraction. */
export async function persistCompanySourceDocs(params: {
	companyId: string;
	docs: RawSourceDocument[];
	organizationId: string;
}): Promise<RawSourceDocument[]> {
	const deduplicated = deduplicateSourceDocuments(params.docs);
	if (deduplicated.length === 0) {
		return [];
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(companySourceDocs)
			.where(eq(companySourceDocs.companyId, params.companyId));

		await tx
			.insert(companySourceDocs)
			.values(
				deduplicated.map((doc) => ({
					companyId: params.companyId,
					fetchedAt: parseSafeFetchedAt(doc.fetchedAt),
					organizationId: params.organizationId,
					sourceType: doc.sourceType,
					text: doc.text,
					title: doc.title,
					url: doc.url,
				}))
			)
			.onConflictDoUpdate({
				set: {
					fetchedAt: sql`excluded.fetched_at`,
					sourceType: sql`excluded.source_type`,
					text: sql`excluded.text`,
					title: sql`excluded.title`,
					updatedAt: new Date(),
				},
				target: [companySourceDocs.companyId, companySourceDocs.url],
			});
	});

	return deduplicated;
}

/** Insert verified evidence rows (deduplicating URL+quote) and return all verified candidates. */
export async function persistResearchEvidence(params: {
	companyId: string;
	existingRows?: (typeof evidence.$inferSelect)[];
	items: VerifiedEvidenceCandidate[];
	organizationId: string;
}): Promise<VerifiedEvidenceCandidate[]> {
	const existing = params.existingRows ?? [];
	const seenKey = new Set(
		existing.map((row) => `${row.url}::${row.quote.trim()}`)
	);
	const merged = toVerifiedEvidenceCandidates(params.companyId, existing).map(
		(candidate, index) => ({
			...candidate,
			sourceTitle: existing[index]?.title ?? candidate.url,
		})
	);

	const toInsert = params.items.filter((item) => {
		const key = `${item.url}::${item.quote.trim()}`;
		if (seenKey.has(key)) {
			return false;
		}
		seenKey.add(key);
		return true;
	});

	if (toInsert.length === 0) {
		return merged;
	}

	const insertedEvidence = await db
		.insert(evidence)
		.values(
			toInsert.map((item) => ({
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

	for (const [index, row] of insertedEvidence.entries()) {
		const original = toInsert[index];
		if (original) {
			merged.push({ ...original, id: row.id });
		}
	}
	return merged;
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

	await db.transaction(async (tx) => {
		await Promise.all(
			rows.map((row) =>
				tx
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
	});
}

function normalizeCandidateContact(
	candidate: CompanyResearchPipelineResult["contact"]
) {
	const safeEmail =
		candidate?.email && !isGenericMailboxEmail(candidate.email)
			? candidate.email
			: null;
	const fullName = candidate
		? `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim()
		: "";
	const resolvedEmailStatus: "guessed" | "unknown" | "verified" | "sandbox" =
		safeEmail ? (candidate?.emailStatus ?? "guessed") : "unknown";
	const hasPersistableContact = Boolean(
		safeEmail || (candidate && hasQualifiedDecisionMakerContact(candidate))
	);
	return {
		fullName,
		hasPersistableContact,
		linkedinUrl: candidate?.linkedinUrl ?? null,
		resolvedEmailStatus,
		role: candidate?.role,
		safeEmail,
	};
}

async function upsertPrimaryContactFromResearch(
	tx: Pick<typeof db, "insert" | "update">,
	params: {
		candidate: CompanyResearchPipelineResult["contact"];
		companyId: string;
		existingPrimaryContact: typeof contacts.$inferSelect | undefined;
		organizationId: string;
	}
): Promise<typeof contacts.$inferSelect | undefined> {
	const normalized = normalizeCandidateContact(params.candidate);
	const { existingPrimaryContact } = params;

	if (existingPrimaryContact) {
		const existingIsGeneric = Boolean(
			existingPrimaryContact.email &&
				isGenericMailboxEmail(existingPrimaryContact.email)
		);
		const needsEmailUpgrade =
			!existingPrimaryContact.email && Boolean(normalized.safeEmail);
		if (!(existingIsGeneric || needsEmailUpgrade)) {
			return existingPrimaryContact;
		}
		const [updatedContact] = await tx
			.update(contacts)
			.set({
				email: normalized.safeEmail,
				emailStatus: normalized.resolvedEmailStatus,
				fullName: normalized.fullName || existingPrimaryContact.fullName,
				linkedinUrl:
					normalized.linkedinUrl ?? existingPrimaryContact.linkedinUrl,
				persona:
					normalized.role || params.candidate?.persona
						? inferPersona(normalized.role, params.candidate?.persona)
						: existingPrimaryContact.persona,
				title: normalized.role ?? existingPrimaryContact.title,
			})
			.where(eq(contacts.id, existingPrimaryContact.id))
			.returning();
		return updatedContact ?? existingPrimaryContact;
	}

	if (!normalized.hasPersistableContact) {
		return;
	}

	const [insertedContact] = await tx
		.insert(contacts)
		.values({
			companyId: params.companyId,
			email: normalized.safeEmail,
			emailStatus: normalized.resolvedEmailStatus,
			fullName: normalized.fullName || "Decision Maker",
			linkedinUrl: normalized.linkedinUrl,
			organizationId: params.organizationId,
			persona: inferPersona(normalized.role, params.candidate?.persona),
			title: normalized.role ?? "Decision Maker",
		})
		.returning();

	return insertedContact;
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

	return await db.transaction(async (tx) => {
		const [currentCompany] = await tx
			.select({ status: companies.status })
			.from(companies)
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			)
			.limit(1);

		const progressedStatuses = new Set([
			"drafted",
			"contacted",
			"replied",
			"meeting_booked",
			"suppressed",
		]);
		const shouldUpdateStatus = !(
			currentCompany && progressedStatuses.has(currentCompany.status)
		);

		await tx
			.update(companies)
			.set({
				channels:
					params.pipeline.channels.length > 0
						? params.pipeline.channels
						: params.existingChannels,
				disqualifyReason: params.pipeline.rubric.disqualificationReason,
				hqLocation: params.pipeline.location ?? params.existingHqLocation,
				lastResearchedAt: new Date(),
				researchError: null,
				score: params.pipeline.rubric.score,
				signals: params.pipeline.signals,
				...(shouldUpdateStatus
					? { status: isQualified ? "qualified" : "disqualified" }
					: {}),
				summary: params.pipeline.summary,
				tier: params.pipeline.rubric.tier,
			})
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			);

		return await upsertPrimaryContactFromResearch(tx, {
			candidate: params.pipeline.contact,
			companyId: params.companyId,
			existingPrimaryContact: params.existingPrimaryContact,
			organizationId: params.organizationId,
		});
	});
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
				and(
					eq(evidence.companyId, companyId),
					eq(evidence.organizationId, organizationId),
					eq(evidence.verified, true)
				)
			)
			.orderBy(desc(evidence.publishedAt)),
		db
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.companyId, companyId),
					eq(contacts.organizationId, organizationId)
				)
			)
			.orderBy(asc(contacts.createdAt))
			.limit(1),
		db
			.select()
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
	]);

	return { primaryContact, settings, verifiedRows };
}

/** Clear any stale pendingJobId on a company's thread. */
export async function clearCompanyThreadPendingJob(
	organizationId: string,
	companyId: string
) {
	await db
		.update(threads)
		.set({ pendingJobId: null })
		.where(
			and(
				eq(threads.organizationId, organizationId),
				eq(threads.companyId, companyId)
			)
		);
}

/** Ensure an SDR thread exists for a company, insert or update a pending-review draft, and log agent runs. */
export async function persistPendingReviewDraft(params: {
	companyId: string;
	contactId: string | null;
	decisionSummary: string;
	emailResult: VerifiedFirstEmailPipelineResult;
	organizationId: string;
	targetMessageId?: string;
}) {
	return await db.transaction(async (tx) => {
		const [existingThread] = await tx
			.select()
			.from(threads)
			.where(
				and(
					eq(threads.organizationId, params.organizationId),
					eq(threads.companyId, params.companyId)
				)
			)
			.for("update")
			.limit(1);

		let threadId = existingThread?.id;
		if (!threadId) {
			const [createdThread] = await tx
				.insert(threads)
				.values({
					aiMode: "auto",
					companyId: params.companyId,
					contactId: params.contactId,
					organizationId: params.organizationId,
					replyToken: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
					status: "awaiting_review",
				})
				.onConflictDoNothing({
					target: [threads.organizationId, threads.companyId],
				})
				.returning({ id: threads.id });
			threadId = createdThread?.id;

			if (!threadId) {
				const [racedThread] = await tx
					.select({ id: threads.id })
					.from(threads)
					.where(
						and(
							eq(threads.organizationId, params.organizationId),
							eq(threads.companyId, params.companyId)
						)
					)
					.for("update")
					.limit(1);
				threadId = racedThread?.id;
			}
		}

		if (!threadId) {
			return null;
		}

		let draftMsgId: string | undefined;
		if (params.targetMessageId) {
			const [existingDraft] = await tx
				.select({ id: messages.id, status: messages.status })
				.from(messages)
				.where(
					and(
						eq(messages.id, params.targetMessageId),
						eq(messages.organizationId, params.organizationId)
					)
				)
				.for("update")
				.limit(1);

			if (
				!(
					existingDraft &&
					["draft", "pending_review"].includes(existingDraft.status)
				)
			) {
				return null;
			}

			const [updatedDraft] = await tx
				.update(messages)
				.set({
					aiOriginalBody: params.emailResult.body,
					bodyText: params.emailResult.body,
					citations: params.emailResult.citations,
					decisionSummary: params.decisionSummary,
					factCheck: params.emailResult.factCheck,
					status: "pending_review",
					subject: params.emailResult.subject,
				})
				.where(
					and(
						eq(messages.id, existingDraft.id),
						eq(messages.organizationId, params.organizationId)
					)
				)
				.returning({ id: messages.id });
			draftMsgId = updatedDraft?.id;
		} else {
			const [insertedDraft] = await tx
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
			draftMsgId = insertedDraft?.id;
		}

		await tx
			.update(companies)
			.set({ status: "drafted" })
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId),
					notInArray(companies.status, [
						"contacted",
						"replied",
						"meeting_booked",
						"suppressed",
					])
				)
			);
		await tx
			.update(threads)
			.set({ pendingJobId: null, status: "awaiting_review" })
			.where(
				and(
					eq(threads.id, threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		if (params.emailResult.telemetry.length > 0) {
			await tx.insert(agentRuns).values(
				params.emailResult.telemetry.map((run) => ({
					companyId: params.companyId,
					decision: params.emailResult.guardResult.passed
						? "pending_review"
						: "flagged",
					guardResults: params.emailResult.guardResult,
					inputTokens: run.tokensIn,
					latencyMs: run.latencyMs,
					messageId: draftMsgId ?? null,
					model: run.model,
					organizationId: params.organizationId,
					output: { summary: run.outputSummary },
					outputTokens: run.tokensOut,
					step: (run.agentName === "fact_check_judge"
						? "factcheck"
						: "write") as "factcheck" | "write",
					threadId,
				}))
			);
		}

		return { messageId: draftMsgId ?? null, threadId };
	});
}

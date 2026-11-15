import { db } from "@workspace/db";
import {
	agentRuns,
	type CompanyStatus,
	type CompanyTier,
	companies,
	contacts,
	evidence,
	meetings,
	qualificationCriteria,
	threads,
} from "@workspace/db/schema";
import { asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

export type CompanySortField =
	| "score_desc"
	| "score_asc"
	| "recent"
	| "oldest"
	| "name_asc";

export interface ListCompaniesFilters {
	includeHidden?: boolean;
	limit?: number;
	offset?: number;
	q?: string;
	signal?: string;
	sort?: CompanySortField;
	status?: CompanyStatus;
	tier?: CompanyTier;
}

function resolveCompanyOrderBy(sort: CompanySortField | undefined) {
	switch (sort) {
		case "score_asc":
			return [
				asc(companies.score),
				desc(companies.createdAt),
				asc(companies.id),
			];
		case "recent":
			return [
				desc(companies.createdAt),
				desc(companies.score),
				asc(companies.id),
			];
		case "oldest":
			return [
				asc(companies.createdAt),
				desc(companies.score),
				asc(companies.id),
			];
		case "name_asc":
			return [asc(companies.name), desc(companies.score), asc(companies.id)];
		default:
			return [
				desc(companies.score),
				desc(companies.createdAt),
				asc(companies.id),
			];
	}
}

/** Query paginated companies for an organization along with matched contacts and thread summaries. */
export async function findCompaniesWithContext(
	organizationId: string,
	filters: ListCompaniesFilters
) {
	const trimmedSignal = filters.signal?.trim();
	const whereClause = withOrg(
		companies,
		organizationId,
		filters.includeHidden ? undefined : eq(companies.hidden, false),
		filters.tier ? eq(companies.tier, filters.tier) : undefined,
		filters.status ? eq(companies.status, filters.status) : undefined,
		filters.q
			? or(
					ilike(companies.name, `%${filters.q}%`),
					ilike(companies.domain, `%${filters.q}%`),
					ilike(companies.summary, `%${filters.q}%`)
				)
			: undefined,
		trimmedSignal
			? sql`EXISTS (SELECT 1 FROM unnest(${companies.signals}) AS sig WHERE sig ILIKE ${`%${trimmedSignal}%`})`
			: undefined
	);

	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;

	const [companyRows, [countRow]] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(whereClause)
			.orderBy(...resolveCompanyOrderBy(filters.sort))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(companies).where(whereClause),
	]);

	const pageCompanyIds = companyRows.map((company) => company.id);
	if (pageCompanyIds.length === 0) {
		return {
			companies: [],
			contacts: [],
			threads: [],
			total: Number(countRow?.total ?? 0),
		};
	}

	const [pageContacts, pageThreads] = await Promise.all([
		db
			.select()
			.from(contacts)
			.where(
				withOrg(
					contacts,
					organizationId,
					inArray(contacts.companyId, pageCompanyIds)
				)
			)
			.orderBy(asc(contacts.createdAt)),
		db
			.select({
				companyId: threads.companyId,
				id: threads.id,
				status: threads.status,
			})
			.from(threads)
			.where(
				withOrg(
					threads,
					organizationId,
					inArray(threads.companyId, pageCompanyIds)
				)
			)
			.orderBy(desc(threads.updatedAt)),
	]);

	return {
		companies: companyRows,
		contacts: pageContacts,
		threads: pageThreads,
		total: Number(countRow?.total ?? 0),
	};
}

/** Find a single company scoped to an organization. */
export async function findCompanyById(
	organizationId: string,
	companyId: string
) {
	const [company] = await db
		.select()
		.from(companies)
		.where(withOrg(companies, organizationId, eq(companies.id, companyId)))
		.limit(1);

	return company ?? null;
}

/** Find an existing company in an organization by normalized domain. */
export async function findCompanyByDomain(
	organizationId: string,
	domain: string
) {
	const [company] = await db
		.select()
		.from(companies)
		.where(withOrg(companies, organizationId, eq(companies.domain, domain)))
		.limit(1);

	return company ?? null;
}

/** Load all detail relations for a company dossier view. */
export async function findCompanyDossierRelations(
	organizationId: string,
	companyId: string
) {
	const [
		criteriaRows,
		evidenceRows,
		contactRows,
		threadRows,
		meetingRows,
		runRows,
	] = await Promise.all([
		db
			.select()
			.from(qualificationCriteria)
			.where(
				withOrg(
					qualificationCriteria,
					organizationId,
					eq(qualificationCriteria.companyId, companyId)
				)
			),
		db
			.select()
			.from(evidence)
			.where(
				withOrg(evidence, organizationId, eq(evidence.companyId, companyId))
			)
			.orderBy(desc(evidence.publishedAt)),
		db
			.select()
			.from(contacts)
			.where(
				withOrg(contacts, organizationId, eq(contacts.companyId, companyId))
			)
			.orderBy(asc(contacts.createdAt)),
		db
			.select()
			.from(threads)
			.where(withOrg(threads, organizationId, eq(threads.companyId, companyId)))
			.orderBy(desc(threads.updatedAt)),
		db
			.select()
			.from(meetings)
			.where(
				withOrg(meetings, organizationId, eq(meetings.companyId, companyId))
			)
			.orderBy(desc(meetings.startAt)),
		db
			.select()
			.from(agentRuns)
			.where(
				withOrg(agentRuns, organizationId, eq(agentRuns.companyId, companyId))
			)
			.orderBy(desc(agentRuns.createdAt)),
	]);

	return {
		agentRuns: runRows,
		contacts: contactRows,
		criteria: criteriaRows,
		evidence: evidenceRows,
		meetings: meetingRows,
		threads: threadRows,
	};
}

/** Create a newly imported company record ready for worker research. */
export async function createImportedCompany(input: {
	domain: string;
	hqLocation?: string;
	name: string;
	organizationId: string;
	website: string;
}) {
	return await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(companies)
			.values({
				domain: input.domain,
				hqLocation: input.hqLocation ?? null,
				name: input.name,
				organizationId: input.organizationId,
				status: "researching",
				website: input.website,
			})
			.onConflictDoNothing({
				target: [companies.organizationId, companies.domain],
			})
			.returning();

		return created ?? null;
	});
}

/** Delete an orphaned newly imported company if initial research queueing fails. */
export async function deleteImportedCompanyOnQueueFailure(
	organizationId: string,
	companyId: string
) {
	await db
		.delete(companies)
		.where(withOrg(companies, organizationId, eq(companies.id, companyId)));
}

/** Update manual qualification overrides on a company record. */
export async function updateCompanyFields(
	organizationId: string,
	companyId: string,
	patch: {
		disqualifyReason?: string | null;
		hidden?: boolean;
		status?: CompanyStatus;
		tier?: CompanyTier;
	}
) {
	const [updated] = await db
		.update(companies)
		.set({
			...(patch.disqualifyReason === undefined
				? {}
				: { disqualifyReason: patch.disqualifyReason }),
			...(patch.hidden === undefined ? {} : { hidden: patch.hidden }),
			...(patch.status ? { status: patch.status } : {}),
			...(patch.tier ? { tier: patch.tier } : {}),
		})
		.where(withOrg(companies, organizationId, eq(companies.id, companyId)))
		.returning();

	return updated ?? null;
}

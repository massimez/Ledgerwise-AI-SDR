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
import { asc, desc, eq, ilike, or } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

export interface ListCompaniesFilters {
	q?: string;
	sort?: "score_desc" | "score_asc" | "recent";
	status?: CompanyStatus;
	tier?: CompanyTier;
}

/** Query companies for an organization along with primary contacts and thread summaries. */
export async function findCompaniesWithContext(
	organizationId: string,
	filters: ListCompaniesFilters
) {
	const conditions = [
		filters.tier ? eq(companies.tier, filters.tier) : undefined,
		filters.status ? eq(companies.status, filters.status) : undefined,
		filters.q
			? or(
					ilike(companies.name, `%${filters.q}%`),
					ilike(companies.domain, `%${filters.q}%`),
					ilike(companies.summary, `%${filters.q}%`)
				)
			: undefined,
	];

	let orderByClause = desc(companies.score);
	if (filters.sort === "score_asc") {
		orderByClause = asc(companies.score);
	} else if (filters.sort === "recent") {
		orderByClause = desc(companies.createdAt);
	}

	const [companyRows, orgContacts, orgThreads] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(withOrg(companies, organizationId, ...conditions))
			.orderBy(orderByClause),
		db.select().from(contacts).where(withOrg(contacts, organizationId)),
		db
			.select({
				companyId: threads.companyId,
				id: threads.id,
				status: threads.status,
			})
			.from(threads)
			.where(withOrg(threads, organizationId)),
	]);

	return {
		companies: companyRows,
		contacts: orgContacts,
		threads: orgThreads,
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
			),
		db
			.select()
			.from(threads)
			.where(
				withOrg(threads, organizationId, eq(threads.companyId, companyId))
			),
		db
			.select()
			.from(meetings)
			.where(
				withOrg(meetings, organizationId, eq(meetings.companyId, companyId))
			),
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
	const [created] = await db
		.insert(companies)
		.values({
			domain: input.domain,
			hqLocation: input.hqLocation ?? null,
			name: input.name,
			organizationId: input.organizationId,
			status: "researching",
			website: input.website,
		})
		.returning();

	return created ?? null;
}

/** Update manual qualification overrides on a company record. */
export async function updateCompanyFields(
	organizationId: string,
	companyId: string,
	patch: {
		disqualifyReason?: string | null;
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
			...(patch.status ? { status: patch.status } : {}),
			...(patch.tier ? { tier: patch.tier } : {}),
		})
		.where(withOrg(companies, organizationId, eq(companies.id, companyId)))
		.returning();

	return updated ?? null;
}

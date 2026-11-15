import {
	assertPublicHttpUrl,
	normalizeDomain,
	SsrfBlockedError,
} from "@workspace/ai-core";
import type { CompanyStatus, CompanyTier } from "@workspace/db/schema";
import { env } from "../../../env";
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { logWarning } from "../../../lib/logger";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import { enqueueSdrPipelineJob } from "../queue";
import {
	createImportedCompany,
	deleteImportedCompanyOnQueueFailure,
	findCompaniesWithContext,
	findCompanyByDomain,
	findCompanyById,
	findCompanyDossierRelations,
	updateCompanyFields,
} from "./companies.repository";

function deriveCompanyNameFromDomain(domain: string): string {
	const root = domain.split(".")[0] ?? domain;
	return root
		.split("-")
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

/** List prospect companies for an organization with optional filters and signal search. */
export async function listCompanies(
	organizationId: string,
	filters: {
		includeHidden?: boolean;
		limit?: number;
		offset?: number;
		q?: string;
		signal?: string;
		sort?: "score_desc" | "score_asc" | "recent" | "oldest" | "name_asc";
		status?: CompanyStatus;
		tier?: CompanyTier;
	}
) {
	const limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;

	const {
		companies: pageRows,
		contacts,
		threads,
		total,
	} = await findCompaniesWithContext(organizationId, {
		includeHidden: filters.includeHidden,
		limit,
		offset,
		q: filters.q,
		signal: filters.signal,
		sort: filters.sort,
		status: filters.status,
		tier: filters.tier,
	});

	const contactByCompanyId = new Map(contacts.map((c) => [c.companyId, c]));
	const threadByCompanyId = new Map(threads.map((t) => [t.companyId, t]));

	return {
		companies: pageRows.map((company) => ({
			...company,
			primaryContact: contactByCompanyId.get(company.id) ?? null,
			thread: threadByCompanyId.get(company.id) ?? null,
		})),
		hasMore: offset + pageRows.length < total,
		limit,
		offset,
		total,
	};
}

/** Load a single company's complete research dossier, criteria, evidence, and threads. */
export async function getCompanyDetail(
	organizationId: string,
	companyId: string
) {
	const company = await findCompanyById(organizationId, companyId);
	if (!company) {
		throw new NotFoundError("Company");
	}

	const relations = await findCompanyDossierRelations(
		organizationId,
		companyId
	);
	return {
		...relations,
		company,
	};
}

/** Import a prospect company by URL and enqueue background research + scoring. */
export async function importCompanyUrl(
	organizationId: string,
	input: {
		hqLocation?: string;
		name?: string;
		website: string;
	}
) {
	await ensureSdrSettingsForOrg(organizationId);
	let normalizedUrl: URL;
	try {
		normalizedUrl = await assertPublicHttpUrl(input.website, {
			allowHttp: true,
		});
	} catch (error) {
		throw new ValidationError(
			error instanceof SsrfBlockedError || error instanceof Error
				? error.message
				: "Invalid or restricted company website URL.",
			{ cause: error, field: "website" }
		);
	}
	const domain = normalizeDomain(normalizedUrl.hostname);

	const existing = await findCompanyByDomain(organizationId, domain);
	if (existing) {
		throw new ConflictError(`Company with domain ${domain} already exists.`);
	}

	const created = await createImportedCompany({
		domain,
		hqLocation: input.hqLocation,
		name: input.name ?? deriveCompanyNameFromDomain(domain),
		organizationId,
		website: normalizedUrl.toString(),
	});

	if (!created) {
		throw new ConflictError(`Company with domain ${domain} already exists.`);
	}

	let queued = false;
	try {
		await enqueueSdrPipelineJob({
			action: "research-company",
			companyId: created.id,
			organizationId,
		});
		queued = true;
	} catch (error) {
		if (env.NODE_ENV === "production") {
			await deleteImportedCompanyOnQueueFailure(
				organizationId,
				created.id
			).catch((cleanupError) => {
				logWarning(
					"SDRCompaniesService:importCompanyUrl",
					"Failed to remove company after enqueue error",
					{ companyId: created.id, error: String(cleanupError) }
				);
			});
			throw error;
		}
		logWarning(
			"SDRCompaniesService:importCompanyUrl",
			"Redis queue unavailable in dev; company saved as researching",
			{ companyId: created.id, error: String(error) }
		);
	}

	return {
		company: created,
		queued,
	};
}

/** Update manual status, tier, or disqualification notes on a company. */
export async function updateCompanyQualification(
	organizationId: string,
	companyId: string,
	patch: {
		disqualifyReason?: string | null;
		hidden?: boolean;
		status?: CompanyStatus;
		tier?: CompanyTier;
	}
) {
	const updated = await updateCompanyFields(organizationId, companyId, patch);
	if (!updated) {
		throw new NotFoundError("Company");
	}
	return updated;
}

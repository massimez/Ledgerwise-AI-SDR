import type { CompanyStatus, CompanyTier } from "@workspace/db/schema";
import { ConflictError, NotFoundError } from "../../../lib/errors";
import { logWarning } from "../../../lib/logger";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import { enqueueSdrPipelineJob } from "../queue";
import {
	createImportedCompany,
	findCompaniesWithContext,
	findCompanyByDomain,
	findCompanyById,
	findCompanyDossierRelations,
	updateCompanyFields,
} from "./companies.repository";

const WWW_PREFIX_REGEX = /^www\./iu;

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
		q?: string;
		signal?: string;
		sort?: "score_desc" | "score_asc" | "recent";
		status?: CompanyStatus;
		tier?: CompanyTier;
	}
) {
	const {
		companies: rows,
		contacts,
		threads,
	} = await findCompaniesWithContext(organizationId, {
		q: filters.q,
		sort: filters.sort,
		status: filters.status,
		tier: filters.tier,
	});

	const normalizedSignal = filters.signal?.toLowerCase();
	const filteredBySignal = normalizedSignal
		? rows.filter((row) =>
				row.signals.some((s) => s.toLowerCase().includes(normalizedSignal))
			)
		: rows;

	const contactByCompanyId = new Map(contacts.map((c) => [c.companyId, c]));
	const threadByCompanyId = new Map(threads.map((t) => [t.companyId, t]));

	return filteredBySignal.map((company) => ({
		...company,
		primaryContact: contactByCompanyId.get(company.id) ?? null,
		thread: threadByCompanyId.get(company.id) ?? null,
	}));
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
	const normalizedUrl = new URL(input.website);
	const domain = normalizedUrl.hostname
		.replace(WWW_PREFIX_REGEX, "")
		.toLowerCase();

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
		throw new Error("Failed to create imported company record");
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

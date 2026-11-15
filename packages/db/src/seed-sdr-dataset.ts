import { readFileSync } from "node:fs";
import type {
	NewAgentRun,
	NewCompany,
	NewCompanySourceDoc,
	NewContact,
	NewEvidence,
	NewMeeting,
	NewMessage,
	NewQualificationCriterion,
	NewSuppression,
	NewThread,
} from "./schema";

export const SEED_RESEARCH_RUN_ID = "11111111-0000-4000-8000-000000000001";

export interface BuiltSdrSeedDataset {
	agentRuns: NewAgentRun[];
	companies: NewCompany[];
	companySourceDocs: NewCompanySourceDoc[];
	contacts: NewContact[];
	evidence: NewEvidence[];
	meetings: NewMeeting[];
	messages: NewMessage[];
	qualificationCriteria: NewQualificationCriterion[];
	suppressions: NewSuppression[];
	threads: NewThread[];
}

interface SeedSnapshotPayload {
	agentRuns: Array<
		Omit<NewAgentRun, "createdAt"> & { createdAt?: string | null }
	>;
	companies: Array<
		Omit<NewCompany, "createdAt" | "lastResearchedAt" | "updatedAt"> & {
			createdAt?: string | null;
			lastResearchedAt?: string | null;
			updatedAt?: string | null;
		}
	>;
	companySourceDocs: Array<
		Omit<NewCompanySourceDoc, "createdAt" | "fetchedAt" | "updatedAt"> & {
			createdAt?: string | null;
			fetchedAt: string;
			updatedAt?: string | null;
		}
	>;
	contacts: Array<
		Omit<NewContact, "createdAt" | "updatedAt"> & {
			createdAt?: string | null;
			updatedAt?: string | null;
		}
	>;
	evidence: Array<
		Omit<
			NewEvidence,
			"createdAt" | "publishedAt" | "retrievedAt" | "updatedAt"
		> & {
			createdAt?: string | null;
			publishedAt?: string | null;
			retrievedAt?: string | null;
			updatedAt?: string | null;
		}
	>;
	meetings: Array<
		Omit<NewMeeting, "createdAt" | "endAt" | "startAt" | "updatedAt"> & {
			createdAt?: string | null;
			endAt: string;
			startAt: string;
			updatedAt?: string | null;
		}
	>;
	messages: Array<
		Omit<NewMessage, "createdAt" | "sentAt" | "updatedAt"> & {
			createdAt?: string | null;
			sentAt?: string | null;
			updatedAt?: string | null;
		}
	>;
	qualificationCriteria: Array<
		Omit<NewQualificationCriterion, "createdAt" | "updatedAt"> & {
			createdAt?: string | null;
			updatedAt?: string | null;
		}
	>;
	suppressions: Array<
		Omit<NewSuppression, "createdAt"> & { createdAt?: string | null }
	>;
	threads: Array<
		Omit<NewThread, "createdAt" | "lastMessageAt" | "updatedAt"> & {
			createdAt?: string | null;
			lastMessageAt?: string | null;
			updatedAt?: string | null;
		}
	>;
}

function toDate(value: string): Date {
	return new Date(value);
}

function toOptionalDate(value: string | null | undefined): Date | undefined {
	return value ? new Date(value) : undefined;
}

function toNullableDate(value: string | null | undefined): Date | null {
	return value ? new Date(value) : null;
}

/**
 * Load the real Exa-researched, LLM-generated SDR workspace snapshot and
 * hydrate ISO timestamp strings back into Drizzle `Date` instances.
 */
export function buildEvalBackedSdrSeedDataset(): BuiltSdrSeedDataset {
	const raw = readFileSync(
		new URL("./seed-sdr-snapshot.json", import.meta.url),
		"utf8"
	);
	const snapshot = JSON.parse(raw) as SeedSnapshotPayload;

	return {
		agentRuns: snapshot.agentRuns.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
		})),
		companies: snapshot.companies.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			lastResearchedAt: toNullableDate(row.lastResearchedAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		companySourceDocs: snapshot.companySourceDocs.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			fetchedAt: toDate(row.fetchedAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		contacts: snapshot.contacts.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		evidence: snapshot.evidence.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			publishedAt: toNullableDate(row.publishedAt),
			retrievedAt: toOptionalDate(row.retrievedAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		meetings: snapshot.meetings.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			endAt: toDate(row.endAt),
			startAt: toDate(row.startAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		messages: snapshot.messages.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			sentAt: toNullableDate(row.sentAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		qualificationCriteria: snapshot.qualificationCriteria.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
		suppressions: snapshot.suppressions.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
		})),
		threads: snapshot.threads.map((row) => ({
			...row,
			createdAt: toOptionalDate(row.createdAt),
			lastMessageAt: toOptionalDate(row.lastMessageAt),
			updatedAt: toOptionalDate(row.updatedAt),
		})),
	};
}

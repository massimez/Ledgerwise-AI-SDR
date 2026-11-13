import type { VerifiedEvidenceCandidate } from "@workspace/ai-core";
import type { evidence } from "@workspace/db/schema/sdr";

/** Infer contact persona bucket from free-text job title. */
export function inferPersona(
	role?: string
): "founder" | "coo" | "finance" | "other" {
	const lower = (role ?? "").toLowerCase();
	if (
		lower.includes("cfo") ||
		lower.includes("controller") ||
		lower.includes("finance") ||
		lower.includes("account")
	) {
		return "finance";
	}
	if (lower.includes("coo") || lower.includes("operations")) {
		return "coo";
	}
	if (lower.includes("founder") || lower.includes("ceo")) {
		return "founder";
	}
	return "other";
}

/** Map source provenance type onto DB `evidence.kind` enum. */
export function mapEvidenceKind(
	sourceType: VerifiedEvidenceCandidate["sourceType"]
): "job_posting" | "funding" | "website" {
	if (sourceType === "ats") {
		return "job_posting";
	}
	if (sourceType === "press") {
		return "funding";
	}
	return "website";
}

/** Map rubric status onto DB `criterionVerdict` enum. */
export function mapFitVerdict(
	status: "pass" | "estimated" | "fail"
): "met" | "unknown" | "not_met" {
	if (status === "pass") {
		return "met";
	}
	if (status === "estimated") {
		return "unknown";
	}
	return "not_met";
}

/** Map persisted `evidence` rows back into `VerifiedEvidenceCandidate[]` for draft generation. */
export function toVerifiedEvidenceCandidates(
	companyName: string,
	rows: (typeof evidence.$inferSelect)[]
): VerifiedEvidenceCandidate[] {
	return rows.map((row) => ({
		claim: row.claim,
		factType: row.kind === "job_posting" ? "hiring" : "news",
		id: row.id,
		quote: row.quote,
		sourceTitle: row.title ?? companyName,
		sourceType: row.kind === "job_posting" ? "ats" : "website",
		url: row.url,
		verified: true,
	}));
}

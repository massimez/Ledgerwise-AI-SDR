import type { VerifiedEvidenceCandidate } from "@workspace/ai-core";
import type { evidence } from "@workspace/db/schema/sdr";

/** Resolve contact persona bucket, honoring structured LLM classification before free-text job-title heuristics. */
export function inferPersona(
	role?: string,
	explicitPersona?: "founder" | "coo" | "finance" | "other" | null
): "founder" | "coo" | "finance" | "other" {
	if (explicitPersona && explicitPersona !== "other") {
		return explicitPersona;
	}
	const lower = (role ?? "").toLowerCase();
	if (
		lower.includes("cfo") ||
		lower.includes("controller") ||
		lower.includes("finance") ||
		lower.includes("account") ||
		lower.includes("bookkeep") ||
		lower.includes("treasurer")
	) {
		return "finance";
	}
	if (
		lower.includes("coo") ||
		lower.includes("operations") ||
		lower.includes("general manager")
	) {
		return "coo";
	}
	if (
		lower.includes("founder") ||
		lower.includes("ceo") ||
		lower.includes("owner") ||
		lower.includes("president") ||
		lower.includes("managing director")
	) {
		return "founder";
	}
	return explicitPersona ?? "other";
}

/** Map DB `evidence.kind` back to research sourceType cleanly. */
export function mapDbEvidenceKindToSourceType(
	kind: (typeof evidence.$inferSelect)["kind"]
): VerifiedEvidenceCandidate["sourceType"] {
	if (kind === "job_posting") {
		return "ats";
	}
	if (kind === "funding" || kind === "press") {
		return "press";
	}
	return "website";
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
		sourceType: mapDbEvidenceKindToSourceType(row.kind),
		url: row.url,
		verified: true,
	}));
}

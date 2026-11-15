import type { ExtractedEvidenceFact } from "../agents";
import type { RubricEvaluationResult } from "../scoring";
import type { AgentRunTelemetry } from "../shared/types";

export type {
	AgentRunTelemetry,
	RawSourceDocument,
	SdrPipelineLogger,
} from "../shared/types";

export interface VerifiedEvidenceCandidate {
	claim: string;
	factType: ExtractedEvidenceFact["factType"];
	id: string;
	quote: string;
	sourceTitle: string;
	sourceType: ExtractedEvidenceFact["sourceType"];
	url: string;
	verified: boolean;
}

export interface CompanyResearchPipelineResult {
	channels: string[];
	contact?: {
		email?: string;
		emailStatus?: "verified" | "guessed" | "unknown";
		firstName?: string;
		isDecisionMaker?: boolean;
		lastName?: string;
		linkedinUrl?: string;
		persona?: "founder" | "coo" | "finance" | "other";
		role?: string;
	};
	evidence: VerifiedEvidenceCandidate[];
	location?: string;
	rubric: RubricEvaluationResult;
	signals: string[];
	summary: string;
	telemetry: AgentRunTelemetry[];
}

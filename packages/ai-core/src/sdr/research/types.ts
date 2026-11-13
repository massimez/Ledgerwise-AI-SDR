import type { ExtractedEvidenceFact } from "../agents";
import type { RubricEvaluationResult } from "../scoring";

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

export interface AgentRunTelemetry {
	agentName: string;
	latencyMs: number;
	model: string;
	outputSummary: string;
	status: "succeeded" | "fallback";
	tokensIn: number;
	tokensOut: number;
}

export interface CompanyResearchPipelineResult {
	channels: string[];
	contact?: {
		email?: string;
		firstName?: string;
		lastName?: string;
		role?: string;
	};
	evidence: VerifiedEvidenceCandidate[];
	location?: string;
	rubric: RubricEvaluationResult;
	signals: string[];
	summary: string;
	telemetry: AgentRunTelemetry[];
}

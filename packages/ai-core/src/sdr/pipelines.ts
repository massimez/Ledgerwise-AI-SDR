export {
	generateVerifiedFirstEmail,
	type VerifiedFirstEmailPipelineResult,
} from "./outreach/first-email-draft";
export { runCompanyResearchPipeline } from "./research/company-pipeline";
export {
	derivePatternContactEmail,
	detectHeadcountBand,
	hasQualifiedDecisionMakerContact,
	isDecisionMakerRole,
	resolveEmployeesInRange,
	runDeterministicFactExtraction,
} from "./research/fact-extractor";
export type {
	AgentRunTelemetry,
	CompanyResearchPipelineResult,
	SdrPipelineLogger,
	VerifiedEvidenceCandidate,
} from "./research/types";
export { isGenericMailboxEmail } from "./shared/domain";

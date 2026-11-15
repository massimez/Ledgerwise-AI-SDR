export interface RawSourceDocument {
	fetchedAt: string;
	sourceType: "exa" | "website" | "shopify_probe" | "ats" | "press" | "curated";
	text: string;
	title: string;
	url: string;
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

export interface SdrPipelineLogger {
	debug?: (
		context: string,
		message: string,
		metadata?: Record<string, unknown>
	) => void;
	error?: (
		context: string,
		message: string,
		metadata?: Record<string, unknown>
	) => void;
	info: (
		context: string,
		message: string,
		metadata?: Record<string, unknown>
	) => void;
	warn: (
		context: string,
		message: string,
		metadata?: Record<string, unknown>
	) => void;
}

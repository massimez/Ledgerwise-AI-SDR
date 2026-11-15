import { Agent } from "@mastra/core/agent";
import type { z } from "zod";
import type { AgentRunTelemetry } from "../shared/types";
import {
	DEFAULT_SDR_MODEL_FAST,
	DEFAULT_SDR_MODEL_GEMINI,
	DEFAULT_SDR_MODEL_SMART,
} from "./schemas";

interface SdrAgentSpec {
	description: string;
	id: string;
	instructions: string;
	name: string;
	tier: "fast" | "smart";
}

const SDR_AGENT_SPECS = {
	discoveryExtractorAgent: {
		description:
			"Extracts actual employer company names, explicit company domains, and verbatim qualification snippets from Exa search results.",
		id: "sdr-discovery-extractor",
		instructions: [
			"For each numbered Exa search result, extract the real company/brand name (`companyName`), official company website domain (`companyDomain`), and a short verbatim `evidenceQuote` copied from the text. Use only the clean brand name (no taglines or generic category placeholders like 'Clean Haircare Brand').",
			"Many search results live on third-party ATS hosts, job boards, VC job portals, media sites, or aggregators (univision.com, jobs.a16z.com, a16z.com, trabajos.*, jobs.*, greenhouse.io, lever.co, ashbyhq.com, workable.com, bamboohr.com, breezy.hr, linkedin.com, wellfound.com, builtin.com, simplify.jobs, indeed.com, glassdoor.com, rrm.com, ecom.jobs, jobrack.eu, zunohire.com, meterwork.com, jobsearcher.com, opentoworkremote.com, career.io). NEVER return the job board, aggregator, ATS host, social host, schema.org, or software vendor mentioned in job descriptions (shopify.com, netsuite.com, quickbooks.intuit.com) as `companyDomain` or `companyName`.",
			"Only populate `companyDomain` when the brand's own website domain explicitly appears in the page title, text, email, or JSON-LD (such as `hiringOrganization.sameAs`/`url`); otherwise set `companyDomain` to null so downstream domain resolution looks it up.",
			"Also set `preScreenStatus`: set to 'disqualified' (with a concise `preScreenReason`) ONLY when the snippet explicitly proves the result fails Ledgerwise ICP before full research — clearly non-US headquarters (UK, Canada, Australia, Europe), clearly non-ecommerce business (recruiting/staffing agency, SaaS software vendor, marketing agency, listicle/directory without an employer brand), or clear enterprise/public scale (>250 employees, stock ticker NASDAQ/NYSE, or Fortune 500 subsidiary). Whenever uncertain or unreported, set `preScreenStatus` to 'pass' and `preScreenReason` to null.",
		].join(" "),
		name: "SDR Discovery Extractor",
		tier: "fast",
	},
	factCheckJudgeAgent: {
		description:
			"Audits outbound drafts to confirm every claim is backed by verified evidence with zero unsupported boasts or pricing.",
		id: "sdr-fact-check-judge",
		instructions: [
			"Audit the draft email against the verified evidence list.",
			"Reject if any company fact is unsupported by the evidence list, if pricing is quoted, if links appear, or if word count >= 100.",
		].join(" "),
		name: "SDR Fact-Check Judge",
		tier: "fast",
	},
	firstEmailWriterAgent: {
		description:
			"Writes conversational, <100-word plain-text first outbound emails referencing only verified evidence.",
		id: "sdr-first-email-writer",
		instructions: [
			"You write outbound first emails on behalf of Ledgerwise (ecommerce bookkeeping and inventory/COGS reconciliation).",
			"Hard rules:",
			"1. Plain text, conversational tone, strictly UNDER 100 words.",
			"2. Zero URLs or links anywhere.",
			"3. Zero pricing, dollar signs ($), retainers, or fee estimates anywhere in the email.",
			"4. Zero physical mailing address footer.",
			"5. Cite at least one verified evidence item by ID and copy an exact short phrase from your email as `span`.",
			"6. End with a low-friction question.",
		].join(" "),
		name: "SDR First Email Writer",
		tier: "smart",
	},
	replyClassifierAgent: {
		description:
			"Classifies prospect replies by intent, bot inquiry, pricing question, confidence, slot choice, and human handoff flag.",
		id: "sdr-reply-classifier",
		instructions: [
			"Classify the prospect's email reply accurately using the provided recent thread messages and booking status.",
			"Set isOptOut=true and intent='opt_out' for both explicit opt-outs AND polite/indirect opt-outs (e.g. 'please remove me from your list', 'take me off this sequence', 'we aren't looking at outside vendors right now'), while distinguishing competitor objections or timing phrases that still show interest (e.g. 'no thanks to Bench, let's chat').",
			"Set asksIfBot=true if they ask whether they are emailing an AI, bot, or automated assistant.",
			"Set mentionsPricing=true if they ask directly or indirectly about cost, fee, retainer, budget, or investment (e.g. 'what do your retainers run?', 'how do you structure fees?').",
			"Set needsInfoFromHuman=true ONLY for custom accounting/tax/legal/security requests outside the provided playbook or genuinely unanswerable ambiguity — do NOT set needsInfoFromHuman=true for meeting confirmation status checks (like 'is it confirmed?') or standard playbook questions answered by the provided playbook.",
			"Set selectedSlotIndex (0, 1, or 2) if the prospect clearly selects one of the previously offered slots (or confirms/follows up on an unambiguous unbooked slot they already picked in the immediately preceding inbound messages).",
		].join(" "),
		name: "SDR Reply Classifier",
		tier: "fast",
	},
	replyGeneratorAgent: {
		description:
			"Drafts helpful, concise email replies strictly bounded by Ledgerwise's approved playbook and offered Cal.com slots.",
		id: "sdr-reply-generator",
		instructions: [
			"Draft a concise, friendly plain-text reply (under 140 words) grounded strictly in the approved playbook and thread context.",
			"If asksIfBot=true or aiDisclosure='always', clearly state you are Ledgerwise's AI assistant working alongside the sales team.",
			"Never quote dollar pricing, monthly fees, or '$' amounts; when pricing is asked, explicitly state that pricing is discussed on a call/walkthrough and offer to book one of the available times.",
			"Only mention meeting times provided in offeredSlots, and if no booking is confirmed yet when they ask 'is it confirmed?', state honestly that no slot is locked in yet and invite them to confirm one of the offered times.",
		].join(" "),
		name: "SDR Reply Generator",
		tier: "smart",
	},
	researchExtractorAgent: {
		description:
			"Extracts verifiable US e-commerce company facts and exact verbatim quotes from raw fetched documents.",
		id: "sdr-research-extractor",
		instructions: [
			"You extract factual signals about US e-commerce brands for Ledgerwise.",
			"Every fact MUST include an exact verbatim quote copied from the provided source text and its exact URL.",
			"Never fabricate metrics, revenue numbers, headcount, or claims not explicitly written in the source text.",
			"Keep summary concise and strictly under 450 characters.",
			"ICP bounds: mark revenueInRange as 'yes' ONLY if annual revenue is explicitly $1M–$10M ('no' if outside $1M–$10M, 'unknown' if unreported); mark employeesInRange as 'yes' ONLY if company employee count is strictly between 5 and 50 inclusive (5 <= employees <= 50), 'no' if < 5 or > 50 (e.g. 71 employees -> 'no'), and 'unknown' if not stated in the sources.",
			"When an exact headcount number is stated for the target company, set reportedEmployeeCount and copy the verbatim employeeCountQuote (ignoring client/customer/brand counts like 'serving 500+ brands'). Set enterpriseEvidenceQuote when enterpriseDisqualifier=true.",
			"Ignore personal work history on linkedin.com/in/* profiles (prior employers, past roles, university info) when judging company headcount, enterpriseDisqualifier, channels, or US HQ — use linkedin.com/in/* ONLY to extract the current executive/finance contact identity (firstName, lastName, role, linkedinUrl, isDecisionMaker, persona).",
			"Prioritize identifying a named individual decision-maker (Founder, Co-Founder, CEO, COO, CFO, Head of Finance, Controller, VP of Finance) from Exa people/LinkedIn results or company About/Leadership pages, capturing firstName, lastName, role, linkedinUrl, isDecisionMaker, and persona when available.",
			"Only populate contact.email if an individual person's direct email address appears verbatim in the sources; NEVER populate generic, support, info, help, helpme, affiliates, privacy, sales, press, careers, or customer-service inboxes, and never invent or guess an email address.",
		].join(" "),
		name: "SDR Research Extractor",
		tier: "fast",
	},
} as const satisfies Record<string, SdrAgentSpec>;

type InternalSdrAgentKey = keyof typeof SDR_AGENT_SPECS;

const sdrAgentCache = new Map<string, Agent>();

function getOrCreateSdrAgent(
	agentKey: InternalSdrAgentKey,
	modelId: string
): Agent {
	const cacheKey = `${agentKey}:${modelId}`;
	const cached = sdrAgentCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const spec = SDR_AGENT_SPECS[agentKey];
	const agent = new Agent({
		description: spec.description,
		id: spec.id,
		instructions: spec.instructions,
		model: modelId,
		name: spec.name,
	});
	sdrAgentCache.set(cacheKey, agent);
	return agent;
}

/** Create Mastra SDR agents bound to configured fast/smart OpenRouter models. */
export function createSdrAgents(options?: {
	fastModel?: string;
	smartModel?: string;
}) {
	const fastModel = options?.fastModel ?? DEFAULT_SDR_MODEL_FAST;
	const smartModel = options?.smartModel ?? DEFAULT_SDR_MODEL_SMART;

	return {
		discoveryExtractorAgent: getOrCreateSdrAgent(
			"discoveryExtractorAgent",
			fastModel
		),
		factCheckJudgeAgent: getOrCreateSdrAgent("factCheckJudgeAgent", fastModel),
		firstEmailWriterAgent: getOrCreateSdrAgent(
			"firstEmailWriterAgent",
			smartModel
		),
		replyClassifierAgent: getOrCreateSdrAgent(
			"replyClassifierAgent",
			fastModel
		),
		replyGeneratorAgent: getOrCreateSdrAgent("replyGeneratorAgent", smartModel),
		researchExtractorAgent: getOrCreateSdrAgent(
			"researchExtractorAgent",
			fastModel
		),
	};
}

export interface SdrModelEnvOverrides {
	googleApiKey?: string;
	openrouterApiKey?: string;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
}

export interface SdrProviderAttemptFailure {
	message: string;
	model: string;
}

/** Raised when both primary (OpenRouter) and fallback (Gemini) LLM calls fail or no provider key exists when required. */
export class SdrLlmFallbackError extends Error {
	readonly failures: SdrProviderAttemptFailure[];

	constructor(message: string, failures: SdrProviderAttemptFailure[] = []) {
		super(message);
		this.name = "SdrLlmFallbackError";
		this.failures = failures;
	}
}

function buildCandidateModelChain(
	primaryModel: string,
	geminiModel: string,
	hasOpenrouterKey: boolean,
	hasGoogleKey: boolean
): string[] {
	const candidates: string[] = [];
	if (hasOpenrouterKey && primaryModel.trim()) {
		candidates.push(primaryModel.trim());
	}
	if (
		hasGoogleKey &&
		geminiModel.trim() &&
		!candidates.includes(geminiModel.trim())
	) {
		candidates.push(geminiModel.trim());
	}
	return candidates;
}

/** Resolve primary OpenRouter models, Gemini fallback model, and enabled provider state. */
export function resolveSdrModelConfig(envOverrides?: SdrModelEnvOverrides) {
	const openrouterApiKey = (
		envOverrides?.openrouterApiKey === undefined
			? process.env.OPENROUTER_API_KEY
			: envOverrides.openrouterApiKey
	)?.trim();
	const googleApiKey = (
		envOverrides?.googleApiKey === undefined
			? (process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY)
			: envOverrides.googleApiKey
	)?.trim();

	const hasOpenrouterKey = Boolean(openrouterApiKey);
	const hasGoogleKey = Boolean(googleApiKey);

	const configuredFast =
		envOverrides?.sdrModelFast?.trim() ||
		process.env.SDR_MODEL_FAST?.trim() ||
		DEFAULT_SDR_MODEL_FAST;
	const configuredSmart =
		envOverrides?.sdrModelSmart?.trim() ||
		process.env.SDR_MODEL_SMART?.trim() ||
		DEFAULT_SDR_MODEL_SMART;

	const envDefaultModel = process.env.MASTRA_DEFAULT_MODEL?.trim();
	const geminiFallbackModel =
		envOverrides?.sdrGeminiModel?.trim() ||
		process.env.SDR_GEMINI_MODEL?.trim() ||
		(envDefaultModel?.startsWith("google/") ? envDefaultModel : undefined) ||
		DEFAULT_SDR_MODEL_GEMINI;

	const fastModels = buildCandidateModelChain(
		configuredFast,
		geminiFallbackModel,
		hasOpenrouterKey,
		hasGoogleKey
	);
	const smartModels = buildCandidateModelChain(
		configuredSmart,
		geminiFallbackModel,
		hasOpenrouterKey,
		hasGoogleKey
	);

	return {
		fastModel: fastModels[0] ?? geminiFallbackModel,
		fastModels,
		geminiFallbackModel,
		hasGoogleKey,
		hasOpenrouterKey,
		llmEnabled: hasOpenrouterKey || hasGoogleKey,
		smartModel: smartModels[0] ?? geminiFallbackModel,
		smartModels,
	};
}

const DEFAULT_SDR_AGENT_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BACKOFF_BASE_MS = 2500;

export const GEMINI_FALLBACK_MODELS = [
	"google/gemini-3.5-flash-lite",
	"google/gemini-2.5-flash-lite",
	"google/gemini-2.5-flash",
] as const;

export interface SdrLlmExecutionPolicy {
	enableGeminiModelChain?: boolean;
	onTelemetry?: (item: AgentRunTelemetry) => void;
	rpm?: number;
}

let activeLlmPolicy: SdrLlmExecutionPolicy | null = null;
const modelCallTimestamps = new Map<string, number[]>();
const modelCooldownUntil = new Map<string, number>();
const unavailableModels = new Set<string>();
let lastGlobalModelCallAt = 0;
let rateLimiterQueue: Promise<void> = Promise.resolve();

/** Configure optional rate-limit RPM pacing, multi-model Gemini chain expansion, and telemetry hooks. */
export function configureSdrLlmExecution(
	policy: SdrLlmExecutionPolicy | null
): void {
	activeLlmPolicy = policy;
	if (!policy) {
		modelCallTimestamps.clear();
		modelCooldownUntil.clear();
		unavailableModels.clear();
		lastGlobalModelCallAt = 0;
	}
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0 || process.env.NODE_ENV === "test") {
		return Promise.resolve();
	}
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandCandidateModels(models: string[]): string[] {
	if (!activeLlmPolicy?.enableGeminiModelChain) {
		return models;
	}
	const expanded: string[] = [];
	for (const model of models) {
		if (!(expanded.includes(model) || unavailableModels.has(model))) {
			expanded.push(model);
		}
		if (model.startsWith("google/")) {
			for (const fallback of GEMINI_FALLBACK_MODELS) {
				if (!(expanded.includes(fallback) || unavailableModels.has(fallback))) {
					expanded.push(fallback);
				}
			}
		}
	}
	return expanded.length > 0 ? expanded : ["google/gemini-3.5-flash-lite"];
}

function pruneWindowTimestamps(modelId: string, now: number): number[] {
	const existing = modelCallTimestamps.get(modelId) ?? [];
	const fresh = existing.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
	modelCallTimestamps.set(modelId, fresh);
	return fresh;
}

function acquireModelRateSlot(modelId: string): Promise<void> {
	const rpm = activeLlmPolicy?.rpm;
	if (!(rpm && rpm > 0) || process.env.NODE_ENV === "test") {
		return Promise.resolve();
	}
	const minSpacingMs = Math.max(
		1800,
		Math.floor(RATE_LIMIT_WINDOW_MS / Math.max(1, Math.round(rpm * 1.4)))
	);
	const task = rateLimiterQueue.then(async () => {
		const now = Date.now();
		const spacingWaitMs = Math.max(
			0,
			lastGlobalModelCallAt + minSpacingMs - now
		);
		if (spacingWaitMs > 0) {
			await sleep(spacingWaitMs);
		}
		const afterSpacing = Date.now();
		const cooldownUntil = modelCooldownUntil.get(modelId) ?? 0;
		if (cooldownUntil > afterSpacing) {
			await sleep(cooldownUntil - afterSpacing);
		}
		const afterCooldown = Date.now();
		const recent = pruneWindowTimestamps(modelId, afterCooldown);
		if (recent.length >= rpm) {
			const oldest = recent[0] ?? afterCooldown;
			const waitMs = Math.min(
				4500,
				Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - afterCooldown + 150)
			);
			if (waitMs > 0) {
				await sleep(waitMs);
			}
		}
		const recordedAt = Date.now();
		lastGlobalModelCallAt = recordedAt;
		const updated = pruneWindowTimestamps(modelId, recordedAt);
		updated.push(recordedAt);
		modelCallTimestamps.set(modelId, updated);
	});
	rateLimiterQueue = task.catch(() => undefined);
	return task;
}

function isRateLimitErrorMessage(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("429") ||
		lower.includes("rate limit") ||
		lower.includes("resource_exhausted") ||
		lower.includes("quota") ||
		lower.includes("503") ||
		lower.includes("high demand") ||
		lower.includes("unavailable") ||
		lower.includes("overloaded")
	);
}

function isModelUnavailable404Error(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("no longer available") ||
		lower.includes("not_found") ||
		lower.includes("404")
	);
}

function resolveUsageTokens(
	usage:
		| {
				completionTokens?: number;
				inputTokens?: number;
				outputTokens?: number;
				promptTokens?: number;
		  }
		| undefined,
	prompt: string,
	output: unknown
): { tokensIn: number; tokensOut: number } {
	const rawIn = usage?.inputTokens ?? usage?.promptTokens ?? 0;
	const rawOut = usage?.outputTokens ?? usage?.completionTokens ?? 0;
	let tokensIn = rawIn;
	if (tokensIn <= 0 && activeLlmPolicy) {
		tokensIn = Math.max(1, Math.ceil(prompt.length / 4));
	}
	let tokensOut = rawOut;
	if (tokensOut <= 0 && activeLlmPolicy) {
		tokensOut = Math.max(1, Math.ceil(JSON.stringify(output ?? {}).length / 4));
	}
	return { tokensIn, tokensOut };
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`${label} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

async function attemptSingleModelCall<TOutput>(params: {
	agentKey: keyof ReturnType<typeof createSdrAgents>;
	modelId: string;
	prompt: string;
	schema: z.ZodType<TOutput>;
	summarizeOutput: (output: TOutput) => string;
	telemetry: AgentRunTelemetry[];
	telemetryAgentName: string;
	timeoutMs?: number;
}): Promise<{ ok: true; output: TOutput } | { error: string; ok: false }> {
	await acquireModelRateSlot(params.modelId);
	const startedAt = Date.now();
	try {
		const agent = getOrCreateSdrAgent(params.agentKey, params.modelId);
		const response = await withTimeout(
			agent.generate(params.prompt, {
				structuredOutput: { schema: params.schema },
			}),
			params.timeoutMs ?? DEFAULT_SDR_AGENT_TIMEOUT_MS,
			`SDR agent "${params.telemetryAgentName}" (${params.modelId})`
		);
		const output = response.object as TOutput;
		const { tokensIn, tokensOut } = resolveUsageTokens(
			response.usage,
			params.prompt,
			output
		);
		const entry: AgentRunTelemetry = {
			agentName: params.telemetryAgentName,
			latencyMs: Date.now() - startedAt,
			model: params.modelId,
			outputSummary: params.summarizeOutput(output),
			status: "succeeded",
			tokensIn,
			tokensOut,
		};
		params.telemetry.push(entry);
		activeLlmPolicy?.onTelemetry?.(entry);
		return { ok: true, output };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isModelUnavailable404Error(message)) {
			unavailableModels.add(params.modelId);
		} else if (isRateLimitErrorMessage(message)) {
			modelCooldownUntil.set(
				params.modelId,
				Date.now() + RATE_LIMIT_BACKOFF_BASE_MS
			);
			if (activeLlmPolicy) {
				await sleep(RATE_LIMIT_BACKOFF_BASE_MS);
			}
		}
		const entry: AgentRunTelemetry = {
			agentName: params.telemetryAgentName,
			latencyMs: Date.now() - startedAt,
			model: params.modelId,
			outputSummary: `provider error: ${message.slice(0, 140)}`,
			status: "fallback",
			tokensIn: 0,
			tokensOut: 0,
		};
		params.telemetry.push(entry);
		activeLlmPolicy?.onTelemetry?.(entry);
		return { error: message, ok: false };
	}
}

/** Execute a structured SDR Mastra agent across ordered provider models (OpenRouter -> Gemini chain), throwing on total failure. */
export async function runSdrAgentWithFallback<TOutput>(params: {
	agentKey: keyof ReturnType<typeof createSdrAgents>;
	models: string[] | undefined;
	prompt: string;
	schema: z.ZodType<TOutput>;
	summarizeOutput: (output: TOutput) => string;
	telemetry: AgentRunTelemetry[];
	telemetryAgentName: string;
	timeoutMs?: number;
}): Promise<TOutput> {
	const baseModels = params.models ?? [];
	if (baseModels.length === 0) {
		throw new SdrLlmFallbackError(
			`SDR agent "${params.telemetryAgentName}" requires an LLM API key (neither OPENROUTER_API_KEY nor GOOGLE_GENERATIVE_AI_API_KEY is configured).`
		);
	}

	const models = expandCandidateModels(baseModels);
	const failures: SdrProviderAttemptFailure[] = [];

	for (const modelId of models) {
		// biome-ignore lint/performance/noAwaitInLoops: sequential fallback tries primary model before fallback models
		let outcome = await attemptSingleModelCall({
			...params,
			modelId,
		});
		if (
			!outcome.ok &&
			activeLlmPolicy &&
			isRateLimitErrorMessage(outcome.error) &&
			!isModelUnavailable404Error(outcome.error)
		) {
			outcome = await attemptSingleModelCall({
				...params,
				modelId,
			});
		}
		if (outcome.ok) {
			return outcome.output;
		}
		failures.push({ message: outcome.error, model: modelId });
	}

	const summary = failures.map((f) => `${f.model}: ${f.message}`).join(" | ");
	throw new SdrLlmFallbackError(
		`SDR agent "${params.telemetryAgentName}" failed across all configured providers (${summary})`,
		failures
	);
}

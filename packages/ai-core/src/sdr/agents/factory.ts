import { Agent } from "@mastra/core/agent";
import { DEFAULT_SDR_MODEL_FAST, DEFAULT_SDR_MODEL_SMART } from "./schemas";

/** Create Mastra SDR agents bound to configured fast/smart OpenRouter models. */
export function createSdrAgents(options?: {
	fastModel?: string;
	smartModel?: string;
}) {
	const fastModel = options?.fastModel ?? DEFAULT_SDR_MODEL_FAST;
	const smartModel = options?.smartModel ?? DEFAULT_SDR_MODEL_SMART;

	const researchExtractorAgent = new Agent({
		id: "sdr-research-extractor",
		name: "SDR Research Extractor",
		description:
			"Extracts verifiable US e-commerce company facts and exact verbatim quotes from raw fetched documents.",
		instructions: [
			"You extract factual signals about US e-commerce brands for Ledgerwise.",
			"Every fact MUST include an exact verbatim quote copied from the provided source text and its exact URL.",
			"Never fabricate metrics, revenue numbers, headcount, or claims not explicitly written in the source text.",
			"Mark revenueInRange or employeesInRange as 'unknown' unless explicitly stated in the sources.",
		].join(" "),
		model: fastModel,
	});

	const firstEmailWriterAgent = new Agent({
		id: "sdr-first-email-writer",
		name: "SDR First Email Writer",
		description:
			"Writes conversational, <100-word plain-text first outbound emails referencing only verified evidence.",
		instructions: [
			"You write outbound first emails on behalf of Ledgerwise (ecommerce bookkeeping and inventory/COGS reconciliation).",
			"Hard rules:",
			"1. Plain text, conversational tone, strictly UNDER 100 words.",
			"2. Zero URLs or links anywhere.",
			"3. Zero pricing, dollar retainers, or fee estimates.",
			"4. Zero physical mailing address footer.",
			"5. Cite at least one verified evidence item by ID and copy an exact short phrase from your email as `span`.",
			"6. End with a low-friction question.",
		].join(" "),
		model: smartModel,
	});

	const factCheckJudgeAgent = new Agent({
		id: "sdr-fact-check-judge",
		name: "SDR Fact-Check Judge",
		description:
			"Audits outbound drafts to confirm every claim is backed by verified evidence with zero unsupported boasts or pricing.",
		instructions: [
			"Audit the draft email against the verified evidence list.",
			"Reject if any company fact is unsupported by the evidence list, if pricing is quoted, if links appear, or if word count >= 100.",
		].join(" "),
		model: fastModel,
	});

	const replyClassifierAgent = new Agent({
		id: "sdr-reply-classifier",
		name: "SDR Reply Classifier",
		description:
			"Classifies prospect replies by intent, bot inquiry, pricing question, confidence, slot choice, and human handoff flag.",
		instructions: [
			"Classify the prospect's email reply accurately.",
			"Set asksIfBot=true if they ask whether they are emailing an AI, bot, or automated assistant.",
			"Set asksPricing=true if they ask about cost, fee, retainer, or pricing.",
			"Set needsInfoFromHuman=true if they ask questions outside the provided playbook or request contract/custom accounting terms.",
			"Set selectedSlotIndex (0, 1, or 2) only if previously offered slots were provided and the prospect clearly picks one.",
		].join(" "),
		model: fastModel,
	});

	const replyGeneratorAgent = new Agent({
		id: "sdr-reply-generator",
		name: "SDR Reply Generator",
		description:
			"Drafts helpful, concise email replies strictly bounded by Ledgerwise's approved playbook and offered Cal.com slots.",
		instructions: [
			"Draft a concise, friendly plain-text reply (under 140 words) grounded strictly in the approved playbook.",
			"If asksIfBot=true or aiDisclosure='always', clearly state you are Ledgerwise's AI assistant working alongside the sales team.",
			"Never quote dollar pricing or monthly fees; defer pricing to a live walkthrough.",
			"Only mention meeting times provided in offeredSlots.",
		].join(" "),
		model: smartModel,
	});

	return {
		factCheckJudgeAgent,
		firstEmailWriterAgent,
		replyClassifierAgent,
		replyGeneratorAgent,
		researchExtractorAgent,
	};
}

/** Resolve active SDR model pair and whether OpenRouter LLM execution is enabled. */
export function resolveSdrModelConfig(envOverrides?: {
	openrouterApiKey?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
}) {
	const apiKey =
		envOverrides?.openrouterApiKey === undefined
			? process.env.OPENROUTER_API_KEY
			: envOverrides.openrouterApiKey;
	const fastModel =
		envOverrides?.sdrModelFast ??
		process.env.SDR_MODEL_FAST ??
		DEFAULT_SDR_MODEL_FAST;
	const smartModel =
		envOverrides?.sdrModelSmart ??
		process.env.SDR_MODEL_SMART ??
		DEFAULT_SDR_MODEL_SMART;

	return {
		fastModel,
		llmEnabled: Boolean(apiKey && apiKey.trim().length > 0),
		smartModel,
	};
}

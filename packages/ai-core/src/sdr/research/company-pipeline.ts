import type { SdrIcpConfig } from "@workspace/db/schema/sdr";
import {
	createSdrAgents,
	type ResearchExtractionOutput,
	researchExtractionOutputSchema,
	resolveSdrModelConfig,
} from "../agents";
import { verifyQuoteAgainstSource } from "../guards";
import type { RawSourceDocument } from "../integrations/research";
import { evaluateQualificationRubric } from "../scoring";
import { runDeterministicFactExtraction } from "./fact-extractor";
import type {
	AgentRunTelemetry,
	CompanyResearchPipelineResult,
	VerifiedEvidenceCandidate,
} from "./types";

async function extractWithOptionalLlm(params: {
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	fastModel: string;
	llmEnabled: boolean;
	telemetry: AgentRunTelemetry[];
}): Promise<ResearchExtractionOutput | null> {
	if (!params.llmEnabled || params.docs.length === 0) {
		return null;
	}

	const startedAt = Date.now();
	try {
		const { researchExtractorAgent } = createSdrAgents({
			fastModel: params.fastModel,
		});
		const sourceBundle = params.docs
			.slice(0, 5)
			.map(
				(doc, index) =>
					`[Source ${index + 1}] URL=${doc.url}\nTYPE=${doc.sourceType}\nTITLE=${doc.title}\nTEXT=${doc.text.slice(0, 2600)}`
			)
			.join("\n\n---\n\n");

		const response = await researchExtractorAgent.generate(
			`Extract verifiable facts and qualification signals for "${params.companyName}" (${params.domain}) from these sources:\n\n${sourceBundle}`,
			{
				structuredOutput: {
					schema: researchExtractionOutputSchema,
				},
			}
		);
		const extracted = response.object;
		params.telemetry.push({
			agentName: "research_extractor",
			latencyMs: Date.now() - startedAt,
			model: params.fastModel,
			outputSummary: `${extracted.facts.length} candidate facts extracted`,
			status: "succeeded",
			tokensIn: response.usage?.inputTokens ?? 0,
			tokensOut: response.usage?.outputTokens ?? 0,
		});
		return extracted;
	} catch {
		return null;
	}
}

function verifyExtractedFacts(
	facts: ResearchExtractionOutput["facts"],
	docs: RawSourceDocument[]
): VerifiedEvidenceCandidate[] {
	const docByUrl = new Map(docs.map((doc) => [doc.url, doc]));
	const verifiedEvidence: VerifiedEvidenceCandidate[] = [];

	for (const fact of facts) {
		const matchedDoc =
			docByUrl.get(fact.url) ??
			docs.find((doc) => verifyQuoteAgainstSource(fact.quote, doc.text));
		if (
			!(matchedDoc && verifyQuoteAgainstSource(fact.quote, matchedDoc.text))
		) {
			continue;
		}
		verifiedEvidence.push({
			claim: fact.claim,
			factType: fact.factType,
			id: crypto.randomUUID(),
			quote: fact.quote,
			sourceTitle: fact.sourceTitle ?? matchedDoc.title,
			sourceType: fact.sourceType,
			url: matchedDoc.url,
			verified: true,
		});
	}

	return verifiedEvidence;
}

/**
 * Run structured research extraction (Mastra OpenRouter agent with deterministic fallback),
 * enforce quote-in-source verification on every claim, and compute the rubric score.
 */
export async function runCompanyResearchPipeline(options: {
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	hasDecisionMaker: boolean;
	icpConfig?: Partial<SdrIcpConfig>;
	openrouterApiKey?: string;
	sdrModelFast?: string;
}): Promise<CompanyResearchPipelineResult> {
	const telemetry: AgentRunTelemetry[] = [];
	const modelConfig = resolveSdrModelConfig({
		openrouterApiKey: options.openrouterApiKey,
		sdrModelFast: options.sdrModelFast,
	});

	let extracted = await extractWithOptionalLlm({
		companyName: options.companyName,
		docs: options.docs,
		domain: options.domain,
		fastModel: modelConfig.fastModel,
		llmEnabled: modelConfig.llmEnabled,
		telemetry,
	});

	if (!extracted) {
		const startedAt = Date.now();
		extracted = runDeterministicFactExtraction({
			companyName: options.companyName,
			docs: options.docs,
		});
		telemetry.push({
			agentName: "research_extractor",
			latencyMs: Date.now() - startedAt,
			model: "deterministic-fallback",
			outputSummary: `${extracted.facts.length} deterministic facts extracted`,
			status: "fallback",
			tokensIn: 0,
			tokensOut: 0,
		});
	}

	const verifiedEvidence = verifyExtractedFacts(extracted.facts, options.docs);
	const hasUsEvidence =
		extracted.usBased ||
		verifiedEvidence.some((item) => item.factType === "us_hq");
	const hasEcomEvidence =
		extracted.ecommerceBrand ||
		verifiedEvidence.some((item) => item.factType === "ecommerce");
	const hasDecisionMaker =
		options.hasDecisionMaker || Boolean(extracted.contact?.email);

	const rubric = evaluateQualificationRubric(
		{
			channels: extracted.channels,
			decisionMakerFound: hasDecisionMaker,
			ecommerceBrand: hasEcomEvidence,
			employeesInRange: extracted.employeesInRange,
			enterpriseDisqualifier: extracted.enterpriseDisqualifier,
			revenueInRange: extracted.revenueInRange,
			signalChannelExpansion:
				extracted.signalChannelExpansion || extracted.channels.length >= 2,
			signalHiringFinanceOps:
				extracted.signalHiringFinanceOps ||
				verifiedEvidence.some((item) => item.factType === "hiring"),
			signalRecentFunding:
				extracted.signalRecentFunding ||
				verifiedEvidence.some((item) => item.factType === "funding"),
			usBased: hasUsEvidence,
		},
		options.icpConfig
	);

	return {
		channels: extracted.channels,
		contact: extracted.contact,
		evidence: verifiedEvidence,
		location: extracted.location,
		rubric,
		signals: rubric.signals,
		summary: extracted.summary,
		telemetry,
	};
}

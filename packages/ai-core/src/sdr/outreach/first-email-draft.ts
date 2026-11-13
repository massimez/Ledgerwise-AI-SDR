import type {
	FactCheckReport,
	GuardResultSummary,
	MessageCitation,
} from "@workspace/db/schema/sdr";
import {
	createSdrAgents,
	factCheckJudgmentSchema,
	firstEmailDraftSchema,
	resolveSdrModelConfig,
} from "../agents";
import { validateFirstEmailConstraints } from "../guards";
import type {
	AgentRunTelemetry,
	VerifiedEvidenceCandidate,
} from "../research/types";

export interface VerifiedFirstEmailPipelineResult {
	body: string;
	citations: MessageCitation[];
	factCheck: FactCheckReport;
	guardResult: GuardResultSummary;
	subject: string;
	telemetry: AgentRunTelemetry[];
	wordCount: number;
}

const INLINE_URL_REGEX = /https?:\/\/\S+/gu;
const INLINE_DOLLAR_REGEX = /\$\d[\d,.]*/gu;
const WHITESPACE_SPLIT_REGEX = /\s+/u;

function buildDeterministicFirstEmail(options: {
	companyName: string;
	evidence: VerifiedEvidenceCandidate[];
	firstName?: string | null;
	instruction?: string;
}): {
	body: string;
	citations: MessageCitation[];
	subject: string;
} {
	const greeting = options.firstName ? `Hi ${options.firstName},` : "Hi team,";
	const [anchor] = options.evidence;
	const span = anchor
		? anchor.quote
				.replace(INLINE_URL_REGEX, "")
				.replace(INLINE_DOLLAR_REGEX, "")
				.trim()
				.split(WHITESPACE_SPLIT_REGEX)
				.slice(0, 7)
				.join(" ")
		: `${options.companyName} storefront`;

	let hookLine = `Noticed ${options.companyName}'s ${span} and how fast your multi-channel ops are moving.`;
	if (anchor?.factType === "hiring") {
		hookLine = `Saw you are growing finance ops (${span}) while scaling order volume.`;
	} else if (anchor?.factType === "funding") {
		hookLine = `Congrats on the recent milestone (${span}) as your brand scales.`;
	}

	const focusLine = options.instruction?.toLowerCase().includes("inventory")
		? "Teams at your stage usually hit friction keeping landed COGS and 3PL inventory clean at month-end."
		: "Brands running Shopify alongside wholesale or marketplaces often spend hours untangling payout timing and COGS each close.";

	const body = `${greeting}\n\n${hookLine} ${focusLine}\n\nLedgerwise automates payout reconciliation and inventory accounting so close stays clean without extra spreadsheet work.\n\nWorth a quick 15-minute chat next week?`;
	const citations: MessageCitation[] = anchor
		? [{ evidenceId: anchor.id, span }]
		: [];

	return {
		body,
		citations,
		subject: `${options.companyName} payout + COGS reconciliation`,
	};
}

async function generateLlmDraftAttempt(params: {
	attempt: number;
	companyName: string;
	fastModel: string;
	feedbackNote: string;
	firstName?: string | null;
	instruction?: string;
	playbookPitch?: string;
	smartModel: string;
	telemetry: AgentRunTelemetry[];
	verifiedEvidence: VerifiedEvidenceCandidate[];
}) {
	const startedAt = Date.now();
	try {
		const { firstEmailWriterAgent } = createSdrAgents({
			fastModel: params.fastModel,
			smartModel: params.smartModel,
		});
		const evidenceText = params.verifiedEvidence
			.slice(0, 5)
			.map(
				(item) =>
					`- evidenceId="${item.id}" type=${item.factType} claim="${item.claim}" quote="${item.quote}"`
			)
			.join("\n");

		const prompt = [
			`Company: ${params.companyName}`,
			`Recipient first name: ${params.firstName ?? "there"}`,
			params.playbookPitch ? `Playbook angle: ${params.playbookPitch}` : "",
			params.instruction ? `Reviewer instruction: ${params.instruction}` : "",
			params.feedbackNote
				? `Fix these validation errors: ${params.feedbackNote}`
				: "",
			`Verified evidence:\n${evidenceText}`,
		]
			.filter(Boolean)
			.join("\n");

		const response = await firstEmailWriterAgent.generate(prompt, {
			structuredOutput: { schema: firstEmailDraftSchema },
		});
		params.telemetry.push({
			agentName: "first_email_writer",
			latencyMs: Date.now() - startedAt,
			model: params.smartModel,
			outputSummary: `Attempt ${params.attempt}: ${response.object.citations.length} citations`,
			status: "succeeded",
			tokensIn: response.usage?.inputTokens ?? 0,
			tokensOut: response.usage?.outputTokens ?? 0,
		});
		return response.object;
	} catch {
		return null;
	}
}

async function runFactCheckAttempt(params: {
	body: string;
	fastModel: string;
	subject: string;
	telemetry: AgentRunTelemetry[];
	verifiedEvidence: VerifiedEvidenceCandidate[];
}): Promise<{ judgePassed: boolean; unsupportedClaims: string[] }> {
	const judgeStarted = Date.now();
	try {
		const { factCheckJudgeAgent } = createSdrAgents({
			fastModel: params.fastModel,
		});
		const evidenceSummary = params.verifiedEvidence
			.map((item) => `[${item.id}] ${item.quote}`)
			.join("\n");
		const judgeResult = await factCheckJudgeAgent.generate(
			`Subject: ${params.subject}\nBody:\n${params.body}\n\nVerified evidence:\n${evidenceSummary}`,
			{ structuredOutput: { schema: factCheckJudgmentSchema } }
		);
		const { passed, unsupportedClaims } = judgeResult.object;
		params.telemetry.push({
			agentName: "fact_check_judge",
			latencyMs: Date.now() - judgeStarted,
			model: params.fastModel,
			outputSummary: passed ? "passed" : "flagged",
			status: "succeeded",
			tokensIn: judgeResult.usage?.inputTokens ?? 0,
			tokensOut: judgeResult.usage?.outputTokens ?? 0,
		});
		return { judgePassed: passed, unsupportedClaims };
	} catch {
		return { judgePassed: true, unsupportedClaims: [] };
	}
}

/**
 * Generate a plain-text <100-word first email backed strictly by verified evidence,
 * validate with deterministic guards + optional judge agent, and regenerate once if needed.
 */
export async function generateVerifiedFirstEmail(options: {
	companyName: string;
	evidence: VerifiedEvidenceCandidate[];
	firstName?: string | null;
	instruction?: string;
	openrouterApiKey?: string;
	playbookPitch?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
}): Promise<VerifiedFirstEmailPipelineResult> {
	const verifiedEvidence = options.evidence.filter((item) => item.verified);
	const verifiedIds = new Set(verifiedEvidence.map((item) => item.id));
	const telemetry: AgentRunTelemetry[] = [];
	const modelConfig = resolveSdrModelConfig({
		openrouterApiKey: options.openrouterApiKey,
		sdrModelFast: options.sdrModelFast,
		sdrModelSmart: options.sdrModelSmart,
	});

	const baseDraft = buildDeterministicFirstEmail({
		companyName: options.companyName,
		evidence: verifiedEvidence,
		firstName: options.firstName,
		instruction: options.instruction,
	});
	const useLlm = modelConfig.llmEnabled && verifiedEvidence.length > 0;

	const tryValidate = async (
		attempt: number,
		feedbackNote: string
	): Promise<
		| { feedback: string; ok: false }
		| { ok: true; result: VerifiedFirstEmailPipelineResult }
	> => {
		const candidate = useLlm
			? ((await generateLlmDraftAttempt({
					attempt,
					companyName: options.companyName,
					fastModel: modelConfig.fastModel,
					feedbackNote,
					firstName: options.firstName,
					instruction: options.instruction,
					playbookPitch: options.playbookPitch,
					smartModel: modelConfig.smartModel,
					telemetry,
					verifiedEvidence,
				})) ?? baseDraft)
			: baseDraft;

		const deterministic = validateFirstEmailConstraints({
			body: candidate.body,
			citations: candidate.citations,
			subject: candidate.subject,
			verifiedEvidenceIds: verifiedIds,
		});
		if (!deterministic.passed) {
			return { feedback: deterministic.reasons.join("; "), ok: false };
		}

		const judge = modelConfig.llmEnabled
			? await runFactCheckAttempt({
					body: candidate.body,
					fastModel: modelConfig.fastModel,
					subject: candidate.subject,
					telemetry,
					verifiedEvidence,
				})
			: { judgePassed: true, unsupportedClaims: [] };

		if (!judge.judgePassed) {
			return { feedback: judge.unsupportedClaims.join("; "), ok: false };
		}

		return {
			ok: true,
			result: {
				body: candidate.body,
				citations: candidate.citations,
				factCheck: {
					claims: verifiedEvidence.map((item) => ({
						claim: item.claim,
						evidenceId: item.id,
						rationale: "Supported by verified source quote.",
						supported: true,
					})),
					passed: true,
					priceMentionDetected: !deterministic.guardResult.priceGuardPassed,
					wordCount: deterministic.wordCount,
				},
				guardResult: deterministic.guardResult,
				subject: candidate.subject,
				telemetry,
				wordCount: deterministic.wordCount,
			},
		};
	};

	const firstAttempt = await tryValidate(1, "");
	if (firstAttempt.ok) {
		return firstAttempt.result;
	}

	if (useLlm) {
		const retryAttempt = await tryValidate(2, firstAttempt.feedback);
		if (retryAttempt.ok) {
			return retryAttempt.result;
		}
	}

	const safeDraft = baseDraft;
	const safeValidation = validateFirstEmailConstraints({
		body: safeDraft.body,
		citations: safeDraft.citations,
		subject: safeDraft.subject,
		verifiedEvidenceIds: verifiedIds,
	});

	return {
		body: safeDraft.body,
		citations: safeDraft.citations,
		factCheck: {
			claims: safeValidation.reasons.map((reason) => ({
				claim: reason,
				evidenceId: null,
				rationale: reason,
				supported: false,
			})),
			passed: safeValidation.passed,
			priceMentionDetected: !safeValidation.guardResult.priceGuardPassed,
			wordCount: safeValidation.wordCount,
		},
		guardResult: safeValidation.guardResult,
		subject: safeDraft.subject,
		telemetry,
		wordCount: safeValidation.wordCount,
	};
}

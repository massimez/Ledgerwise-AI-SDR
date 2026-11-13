import type {
	OfferedSlot,
	ReplyClassificationReport,
	SdrAiDisclosureMode,
	SdrPlaybookConfig,
} from "@workspace/db/schema/sdr";
import { createSdrAgents, generatedReplySchema } from "../agents";
import type { CalcomBookingResult } from "../integrations/calcom";
import type { AgentRunTelemetry } from "../pipelines";
import type { InboundReplyPipelineInput } from "./types";

const WHITESPACE_SPLIT_REGEX = /\s+/u;
const BENCH_OR_SOFTWARE_REGEX = /\b(?:bench|pilot|finaloop|software)\b/iu;
const BOOKKEEPER_OR_CPA_REGEX =
	/\b(?:bookkeeper|in-house|local cpa|current cpa|our cpa)\b/iu;
const ONBOARDING_REGEX = /\b(?:onboarding|how long|setup time|two weeks)\b/iu;
const REPLACE_CPA_REGEX = /\b(?:replace our|tax cpa|year-?end)\b/iu;
const SHOPIFY_OR_AMAZON_REGEX =
	/\b(?:shopify|amazon|seller central|fba|payout|settlement|reconcil)/iu;
const COGS_OR_3PL_REGEX =
	/\b(?:cogs|inventory|3pl|shipbob|red stag|deliverr|netsuite|quickbooks|qbo|xero)\b/iu;
const STARTS_WITH_NEVER_REGEX = /^never\b/iu;
const POLICY_PRICE_PHRASE_REGEX = /\bmonthly\s+(?:fee|retainer)\b/iu;

function matchPricingCopy(playbook: SdrPlaybookConfig): string {
	const candidatePolicy = playbook.pricingPolicy.trim();
	const isCustomerSafePolicy =
		candidatePolicy.length > 0 &&
		!STARTS_WITH_NEVER_REGEX.test(candidatePolicy) &&
		!POLICY_PRICE_PHRASE_REGEX.test(candidatePolicy);
	return isCustomerSafePolicy
		? candidatePolicy
		: "We tailor scope based on monthly order volume, active sales channels, and inventory or 3PL complexity, so we walk through pricing live on a brief intro call rather than quoting numbers over email.";
}

function matchObjectionGuidance(
	cleanedBody: string,
	playbook: SdrPlaybookConfig
): string | null {
	const targetNeedle = BENCH_OR_SOFTWARE_REGEX.test(cleanedBody)
		? "bench"
		: "bookkeeper";
	const matchedObjection =
		playbook.objectionHandling.find((item) =>
			item.objection.toLowerCase().includes(targetNeedle)
		) ?? playbook.objectionHandling[0];
	return matchedObjection?.responseGuidance ?? null;
}

function matchFaqCopy(
	cleanedBody: string,
	playbook: SdrPlaybookConfig
): string | null {
	const faqMatchers: [RegExp, number][] = [
		[ONBOARDING_REGEX, 1],
		[REPLACE_CPA_REGEX, 2],
		[SHOPIFY_OR_AMAZON_REGEX, 0],
	];
	for (const [pattern, faqIndex] of faqMatchers) {
		const answer = playbook.faq[faqIndex]?.answer;
		if (pattern.test(cleanedBody) && answer) {
			return answer;
		}
	}
	if (BOOKKEEPER_OR_CPA_REGEX.test(cleanedBody)) {
		return matchObjectionGuidance("bookkeeper", playbook);
	}
	if (COGS_OR_3PL_REGEX.test(cleanedBody)) {
		return (
			playbook.services.find((svc) => svc.toLowerCase().includes("cogs")) ??
			"We handle SKU-level landed COGS, 3PL inventory syncs, and clean QuickBooks or Xero accrual reconciliations across your storefront and marketplace channels."
		);
	}
	return null;
}

function selectPlaybookSnippet(params: {
	classification: ReplyClassificationReport;
	cleanedBody: string;
	playbook: SdrPlaybookConfig;
}): string {
	const { classification, cleanedBody, playbook } = params;

	if (classification.mentionsPricing) {
		return matchPricingCopy(playbook);
	}

	if (classification.intent === "objection") {
		const objectionCopy = matchObjectionGuidance(cleanedBody, playbook);
		if (objectionCopy) {
			return objectionCopy;
		}
	}

	const faqCopy = matchFaqCopy(cleanedBody, playbook);
	if (faqCopy) {
		return faqCopy;
	}

	return (
		playbook.companyDescription ||
		"Ledgerwise reconciles Shopify and Amazon payouts against inventory COGS automatically so month-end close stays fast and audit-ready."
	);
}

/** Build a deterministic guard-compliant reply covering bot disclosure, pricing deferral, and Cal.com slots. */
export function buildDeterministicReplyCopy(options: {
	aiDisclosureMode: SdrAiDisclosureMode;
	booking: CalcomBookingResult | null;
	classification: ReplyClassificationReport;
	cleanedBody?: string;
	companyName: string;
	contactName: string;
	offeredSlots: OfferedSlot[];
	playbook: SdrPlaybookConfig;
	subject: string;
}): { body: string; subject: string } {
	const firstName =
		options.contactName.split(WHITESPACE_SPLIT_REGEX)[0] || "there";
	const cleanSubject = options.subject.startsWith("Re:")
		? options.subject
		: `Re: ${options.subject}`;

	const paragraphs: string[] = [`Hi ${firstName},`];

	if (
		options.aiDisclosureMode === "always" ||
		(options.aiDisclosureMode === "when_asked" &&
			options.classification.asksIfBot)
	) {
		paragraphs.push(
			"To answer honestly, I am Ledgerwise's AI assistant working alongside our sales team."
		);
	}

	if (options.booking) {
		const chosenSlot = options.offeredSlots.find(
			(slot) => slot.startIso === options.booking?.startTimeIso
		);
		paragraphs.push(
			`Booked your walkthrough for ${chosenSlot?.formattedLabel ?? options.booking.startTimeIso}. Your calendar invite link is ${options.booking.meetingUrl}. Looking forward to speaking with ${options.companyName}!`
		);
		return { body: paragraphs.join("\n\n"), subject: cleanSubject };
	}

	paragraphs.push(
		selectPlaybookSnippet({
			classification: options.classification,
			cleanedBody: options.cleanedBody ?? "",
			playbook: options.playbook,
		})
	);

	if (options.offeredSlots.length > 0) {
		const lines = options.offeredSlots
			.map((slot, index) => `${index + 1}. ${slot.formattedLabel}`)
			.join("\n");
		paragraphs.push(
			`Do any of these 20-minute windows work to walk through ${options.companyName}'s setup?\n${lines}`
		);
	} else {
		paragraphs.push(
			options.playbook.callToAction ||
				"Would a quick 20-minute walkthrough this week be helpful?"
		);
	}

	return {
		body: paragraphs.join("\n\n"),
		subject: cleanSubject,
	};
}

/** Generate an LLM reply grounded in the playbook and offered slots, falling back to safe copy. */
export async function draftWithOptionalLlm(params: {
	booking: CalcomBookingResult | null;
	classification: ReplyClassificationReport;
	cleanedBody: string;
	fallback: { body: string; subject: string };
	input: InboundReplyPipelineInput;
	llmEnabled: boolean;
	offeredSlots: OfferedSlot[];
	smartModel: string;
	telemetry: AgentRunTelemetry[];
}): Promise<{ body: string; subject: string }> {
	if (!params.llmEnabled) {
		return params.fallback;
	}

	const startedAt = Date.now();
	try {
		const { replyGeneratorAgent } = createSdrAgents({
			smartModel: params.smartModel,
		});
		const prompt = [
			`Company: ${params.input.companyName}`,
			`Contact: ${params.input.contactName}`,
			`AI Disclosure setting: ${params.input.aiDisclosureMode} (asksIfBot=${params.classification.asksIfBot})`,
			`Approved Playbook: ${JSON.stringify(params.input.playbook)}`,
			`Prospect reply: ${params.cleanedBody}`,
			params.booking
				? `Booking confirmed: ${params.booking.startTimeIso} link=${params.booking.meetingUrl}`
				: `Offered slots: ${JSON.stringify(params.offeredSlots)}`,
		].join("\n");

		const response = await replyGeneratorAgent.generate(prompt, {
			structuredOutput: { schema: generatedReplySchema },
		});
		params.telemetry.push({
			agentName: "reply_generator",
			latencyMs: Date.now() - startedAt,
			model: params.smartModel,
			outputSummary: "LLM reply drafted",
			status: "succeeded",
			tokensIn: response.usage?.inputTokens ?? 0,
			tokensOut: response.usage?.outputTokens ?? 0,
		});
		return {
			body: response.object.body,
			subject: response.object.subject,
		};
	} catch {
		return params.fallback;
	}
}

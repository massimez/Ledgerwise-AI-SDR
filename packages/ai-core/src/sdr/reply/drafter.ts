import type {
	OfferedSlot,
	ReplyClassificationReport,
	SdrAiDisclosureMode,
	SdrPlaybookConfig,
} from "@workspace/db/schema/sdr";
import { generatedReplySchema, runSdrAgentWithFallback } from "../agents";
import type { CalcomBookingResult } from "../integrations/calcom";
import type { AgentRunTelemetry } from "../pipelines";
import { formatThreadConversationSnippet } from "./classifier";
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
const FAQ_TOPIC_MATCHERS: readonly [RegExp, RegExp][] = [
	[ONBOARDING_REGEX, /\b(?:onboarding|how long|setup|two weeks)\b/iu],
	[REPLACE_CPA_REGEX, /\b(?:replace|tax cpa|year-?end)\b/iu],
	[SHOPIFY_OR_AMAZON_REGEX, /\b(?:shopify|amazon|payout|reconcil)/iu],
];

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
	for (const [inboundPattern, faqTopicPattern] of FAQ_TOPIC_MATCHERS) {
		if (!inboundPattern.test(cleanedBody)) {
			continue;
		}
		const matched = playbook.faq.find(
			(item) =>
				faqTopicPattern.test(item.question) || faqTopicPattern.test(item.answer)
		);
		if (matched?.answer) {
			return matched.answer;
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
	alreadyBooked?: boolean;
	booking: CalcomBookingResult | null;
	classification: ReplyClassificationReport;
	cleanedBody?: string;
	companyName: string;
	contactName: string;
	offeredSlots: OfferedSlot[];
	playbook: SdrPlaybookConfig;
	slotConflictTakenLabel?: string | null;
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

	if (options.alreadyBooked) {
		paragraphs.push(
			`Your discovery call for ${options.companyName} is already confirmed on our calendar—let us know if you need to adjust anything ahead of the chat!`
		);
		return { body: paragraphs.join("\n\n"), subject: cleanSubject };
	}

	if (options.slotConflictTakenLabel) {
		const lines = options.offeredSlots
			.map((slot, index) => `${index + 1}. ${slot.formattedLabel}`)
			.join("\n");
		paragraphs.push(
			`Looks like ${options.slotConflictTakenLabel} was just taken on the calendar—here are three fresh 20-minute windows for ${options.companyName}:\n${lines}`
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

/** Generate an LLM reply across OpenRouter -> Gemini fallback, throwing if all providers fail. */
export async function draftWithOptionalLlm(params: {
	booking: CalcomBookingResult | null;
	classification: ReplyClassificationReport;
	cleanedBody: string;
	fallback: { body: string; subject: string };
	input: InboundReplyPipelineInput;
	llmEnabled: boolean;
	offeredSlots: OfferedSlot[];
	requireLlm?: boolean;
	smartModels: string[];
	telemetry: AgentRunTelemetry[];
}): Promise<{ body: string; subject: string }> {
	if (!(params.llmEnabled || params.requireLlm)) {
		return params.fallback;
	}

	const recentSummary = formatThreadConversationSnippet(
		params.input.recentMessages
	);
	const calendarStatus = (() => {
		if (params.booking) {
			return `Booking confirmed NOW: ${params.booking.startTimeIso} link=${params.booking.meetingUrl}`;
		}
		if (params.input.existingBookingUid) {
			return `Existing booking already confirmed on calendar (uid=${params.input.existingBookingUid})`;
		}
		return `No meeting booked yet. Offered slots: ${JSON.stringify(params.offeredSlots)}`;
	})();

	const prompt = [
		`Company: ${params.input.companyName}`,
		`Contact: ${params.input.contactName}`,
		`AI Disclosure setting: ${params.input.aiDisclosureMode} (asksIfBot=${params.classification.asksIfBot})`,
		`Approved Playbook: ${JSON.stringify(params.input.playbook)}`,
		`Recent conversation:\n${recentSummary}`,
		`Latest prospect reply: ${params.cleanedBody}`,
		calendarStatus,
	].join("\n");

	const drafted = await runSdrAgentWithFallback({
		agentKey: "replyGeneratorAgent",
		models: params.smartModels,
		prompt,
		schema: generatedReplySchema,
		summarizeOutput: () => "LLM reply drafted",
		telemetry: params.telemetry,
		telemetryAgentName: "reply_generator",
	});

	return {
		body: drafted.body,
		subject: drafted.subject,
	};
}

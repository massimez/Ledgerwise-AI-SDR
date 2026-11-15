import type {
	GuardResultSummary,
	MessageCitation,
} from "@workspace/db/schema/sdr";
import {
	countEmailWords,
	detectOutboundPriceViolation,
	hasUrlLink,
	verifyBotDisclosure,
} from "./content-guards";
import { normalizeTextForMatch } from "./quote-verifier";

const PHYSICAL_ADDRESS_REGEX =
	/\b\d{1,5}\s+[a-z0-9.\s]{2,40}\s(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|suite|ste|floor|fl)\b|\b[a-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/iu;

export interface FirstEmailValidationInput {
	body: string;
	citations: MessageCitation[];
	subject: string;
	verifiedEvidenceIds: Set<string>;
}

export interface FirstEmailValidationResult {
	guardResult: GuardResultSummary;
	passed: boolean;
	reasons: string[];
	wordCount: number;
}

export interface ReplyValidationInput {
	aiDisclosureMode: "when_asked" | "always";
	asksIfBot: boolean;
	body: string;
	citedSpans?: string[];
	subject?: string;
}

/**
 * Enforce all first-email domain invariants:
 * - conversational plain text < 100 words
 * - zero links/URLs, zero prices, zero physical address footer
 * - non-empty citations referencing verified evidence with matching body spans
 */
export function validateFirstEmailConstraints(
	input: FirstEmailValidationInput
): FirstEmailValidationResult {
	const reasons: string[] = [];
	const combinedText = `${input.subject}\n${input.body}`;
	const wordCount = countEmailWords(input.body);

	const wordCountOk = wordCount > 0 && wordCount < 100;
	if (!wordCountOk) {
		reasons.push(
			wordCount === 0
				? "Email body is empty."
				: `First email exceeds 99-word cap (${wordCount} words).`
		);
	}

	const linkCheck = !hasUrlLink(combinedText);
	if (!linkCheck) {
		reasons.push("First email must not contain URLs or links.");
	}

	if (PHYSICAL_ADDRESS_REGEX.test(input.body)) {
		reasons.push("First email must omit physical mailing address footers.");
	}

	const citedSpans = input.citations.map((citation) => citation.span);
	const priceViolation = detectOutboundPriceViolation(combinedText, citedSpans);
	const priceCheck = priceViolation === null;
	if (!priceCheck) {
		reasons.push(`Prohibited pricing mention detected: "${priceViolation}".`);
	}

	const normalizedBody = normalizeTextForMatch(input.body);
	let verifiedCitationsOk = input.citations.length > 0;
	if (verifiedCitationsOk) {
		for (const citation of input.citations) {
			if (!input.verifiedEvidenceIds.has(citation.evidenceId)) {
				verifiedCitationsOk = false;
				reasons.push(
					`Citation references unverified or unknown evidenceId: ${citation.evidenceId}.`
				);
				break;
			}
			const normalizedSpan = normalizeTextForMatch(citation.span);
			if (
				normalizedSpan.length < 4 ||
				!normalizedBody.includes(normalizedSpan)
			) {
				verifiedCitationsOk = false;
				reasons.push(
					`Cited span "${citation.span}" does not appear in draft body.`
				);
				break;
			}
		}
	} else {
		reasons.push("First email must cite at least one verified evidence item.");
	}

	return {
		guardResult: {
			botDisclosureValid: true,
			citationsVerified: verifiedCitationsOk,
			passed: reasons.length === 0,
			priceGuardPassed: priceCheck,
			violations: reasons,
			wordCountPassed: wordCountOk,
		},
		passed: reasons.length === 0,
		reasons,
		wordCount,
	};
}

/** Validate an outbound auto-reply against pricing, word cap, and bot disclosure guards. */
export function validateReplyConstraints(input: ReplyValidationInput): {
	guardResult: GuardResultSummary;
	passed: boolean;
	reasons: string[];
} {
	const reasons: string[] = [];
	const citedSpans = input.citedSpans ?? [];
	const wordCount = countEmailWords(input.body);
	const wordCountCheck = wordCount > 0 && wordCount <= 160;
	if (!wordCountCheck) {
		reasons.push(
			wordCount === 0
				? "Reply body is empty."
				: `Reply exceeds 160-word limit (${wordCount} words).`
		);
	}

	const combinedText = input.subject
		? `${input.subject}\n${input.body}`
		: input.body;
	const priceViolation = detectOutboundPriceViolation(combinedText, citedSpans);
	const priceCheck = priceViolation === null;
	if (!priceCheck) {
		reasons.push(`Reply quotes prohibited pricing: "${priceViolation}".`);
	}

	const needsDisclosure =
		input.aiDisclosureMode === "always" ||
		(input.aiDisclosureMode === "when_asked" && input.asksIfBot);
	const botDisclosureCheck = needsDisclosure
		? verifyBotDisclosure(input.body)
		: true;
	if (!botDisclosureCheck) {
		reasons.push("Reply failed required AI assistant disclosure check.");
	}

	const passed = reasons.length === 0;
	return {
		guardResult: {
			botDisclosureValid: botDisclosureCheck,
			citationsVerified: true,
			passed,
			priceGuardPassed: priceCheck,
			violations: reasons,
			wordCountPassed: wordCountCheck,
		},
		passed,
		reasons,
	};
}

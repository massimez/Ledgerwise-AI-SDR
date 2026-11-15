import { DIACRITICS_REGEX } from "../shared/domain";

const DASH_REGEX = /[\u2010-\u2015\u2212]/gu;
const APOSTROPHE_QUOTE_REGEX =
	/[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033]/gu;
const US_DOT_REGEX = /\bu\.s\.a?\b/giu;
const ECOM_HYPHEN_REGEX = /\be-?commerce\b/giu;
const NON_WORD_REGEX = /[^a-z0-9\s]/gu;
const MULTI_SPACE_REGEX = /\s+/gu;
const FUZZY_OVERLAP_THRESHOLD = 0.85;
const MIN_FUZZY_TOKENS = 4;

/** Normalize text to lowercase alphanumeric tokens separated by single spaces, folding diacritics and typography. */
export function normalizeTextForMatch(input: string): string {
	return input
		.normalize("NFD")
		.replace(DIACRITICS_REGEX, "")
		.replace(DASH_REGEX, " ")
		.replace(APOSTROPHE_QUOTE_REGEX, "'")
		.replace(US_DOT_REGEX, "us")
		.replace(ECOM_HYPHEN_REGEX, "ecommerce")
		.toLowerCase()
		.replace(NON_WORD_REGEX, " ")
		.replace(MULTI_SPACE_REGEX, " ")
		.trim();
}

function buildTokenCounts(tokens: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

/** Verify that a verbatim quote exists in source text via exact substring or >=85% multiset token overlap. */
export function verifyQuoteAgainstSource(
	quote: string,
	sourceText: string
): boolean {
	const normalizedQuote = normalizeTextForMatch(quote);
	const normalizedSource = normalizeTextForMatch(sourceText);

	if (normalizedQuote.length < 12 || normalizedSource.length === 0) {
		return false;
	}

	if (normalizedSource.includes(normalizedQuote)) {
		return true;
	}

	const quoteTokens = normalizedQuote.split(" ");
	const sourceTokens = normalizedSource.split(" ");
	const minRequiredSourceTokens = Math.ceil(
		quoteTokens.length * FUZZY_OVERLAP_THRESHOLD
	);
	if (
		quoteTokens.length < MIN_FUZZY_TOKENS ||
		sourceTokens.length < minRequiredSourceTokens
	) {
		return false;
	}

	const quoteTokenCounts = buildTokenCounts(quoteTokens);
	const extraWindow = Math.min(3, Math.ceil(quoteTokens.length * 0.15));
	const windowSize = Math.min(
		sourceTokens.length,
		quoteTokens.length + extraWindow
	);
	for (let i = 0; i <= sourceTokens.length - windowSize; i += 1) {
		const remaining = new Map(quoteTokenCounts);
		let overlap = 0;
		for (let j = i; j < i + windowSize; j += 1) {
			const token = sourceTokens[j];
			if (!token) {
				continue;
			}
			const count = remaining.get(token) ?? 0;
			if (count > 0) {
				remaining.set(token, count - 1);
				overlap += 1;
			}
		}
		if (overlap / quoteTokens.length >= FUZZY_OVERLAP_THRESHOLD) {
			return true;
		}
	}

	return false;
}

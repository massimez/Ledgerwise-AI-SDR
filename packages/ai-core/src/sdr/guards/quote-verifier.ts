const NON_WORD_REGEX = /[^a-z0-9\s]/gu;
const MULTI_SPACE_REGEX = /\s+/gu;
const FUZZY_OVERLAP_THRESHOLD = 0.9;
const MIN_FUZZY_TOKENS = 4;

/** Normalize text to lowercase alphanumeric tokens separated by single spaces. */
export function normalizeTextForMatch(input: string): string {
	return input
		.toLowerCase()
		.replace(NON_WORD_REGEX, " ")
		.replace(MULTI_SPACE_REGEX, " ")
		.trim();
}

/** Verify that a verbatim quote exists in source text via exact substring or >=90% token overlap. */
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
	if (
		quoteTokens.length < MIN_FUZZY_TOKENS ||
		sourceTokens.length < quoteTokens.length
	) {
		return false;
	}

	const quoteSet = new Set(quoteTokens);
	const windowSize = quoteTokens.length;
	for (let i = 0; i <= sourceTokens.length - windowSize; i += 1) {
		const windowSlice = sourceTokens.slice(i, i + windowSize);
		let overlap = 0;
		for (const token of windowSlice) {
			if (quoteSet.has(token)) {
				overlap += 1;
			}
		}
		if (overlap / windowSize >= FUZZY_OVERLAP_THRESHOLD) {
			return true;
		}
	}

	return false;
}

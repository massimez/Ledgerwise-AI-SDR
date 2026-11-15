const LINE_SPLIT_REGEX = /\r?\n/u;
const SPACE_SPLIT_REGEX = /\s+/u;
const PRICE_DOLLAR_REGEX = /\$\s?\d[\d,]*(?:\.\d{1,2})?\s?(?:k|m|b)?/giu;
const PRICE_PHRASE_REGEX =
	/\b(?:\d[\d,]*(?:\.\d+)?\s*(?:per month|\/\s?mo|a month|monthly)|flat\s+(?:monthly\s+)?fee|monthly\s+(?:fee|retainer)|starts?\s+at\s+\$\d|starting\s+at\s+\$\d|retainer\s+is|costs?\s+\$?\d|pricing\s+(?:is|starts)\s+at\s+\$\d|rate\s+of\s+\$\d)\b/iu;
const URL_IN_EMAIL_REGEX = /\b(?:https?:\/\/|www\.)\S+/iu;
const NEGATED_OPT_OUT_REGEX =
	/\bnot interested in (?:waiting|missing|delaying|wasting|paying more)\b/iu;

const HARD_OPT_OUT_PATTERNS: RegExp[] = [
	/\bunsubscribe\b/iu,
	/\bopt[\s-]*out\b/iu,
	/\bstop\s+(?:emailing|contacting|sending|reaching out|messaging|following up)\b/iu,
	/\b(?:do not|don'?t)\s+(?:contact|email|reach out|message|follow up)\b/iu,
	/\bplease stop\b/iu,
	/\bleave me alone\b/iu,
	/\bcease and desist\b/iu,
	/^stop[.!]?$/iu,
];

const SOFT_OPT_OUT_PATTERNS: RegExp[] = [
	/\b(?:remove|take)\s+(?:me|us)\s*(?:from|off)?\b/iu,
	/\bno thanks?\b/iu,
	/\bno thank you\b/iu,
	/\bnot interested\b/iu,
	/\bno longer interested\b/iu,
	/\b(?:please|we'?ll|going to)\s+pass\b/iu,
	/\bnot a (?:good )?fit\b/iu,
];

const BOT_QUESTION_PATTERNS: RegExp[] = [
	/\bare you (?:a |an )?(?:ai|bot|robot|automated|human|real person)\b/iu,
	/\bis this (?:a |an )?(?:ai|bot|automated|chatgpt|llm|real human|real person)\b/iu,
	/\bam i (?:talking to|speaking (?:to|with)|emailing|writing(?: to)?) (?:a |an )?(?:ai|bot|human|person)\b/iu,
	/\btalking to (?:a |an )?(?:ai|bot)\b/iu,
	/\b(?:human|person) or (?:an? )?(?:ai|bot)\b/iu,
	/\b(?:using ai to reply|automated (?:reply|response|email)|bot writing this)\b/iu,
];

const BOT_DISCLOSURE_PATTERNS: RegExp[] = [
	/\bledgerwise'?s?\s+ai\s+(?:assistant|sdr|agent)\b/iu,
	/\bi(?:'m| am)\s+(?:an?\s+)?ai\s+(?:assistant|sdr|agent)\b/iu,
	/\bautomated\s+(?:ai\s+)?assistant\b/iu,
];

const QUOTED_HEADER_REGEX = /^(?:On .+ wrote:|From:\s|Sent:\s|Subject:\s)/iu;
const QUOTED_LINE_REGEX = /^>/u;

/** Strip email client reply quotes (`On ... wrote:` / `>`) for accurate intent classification. */
export function stripQuotedReplyText(rawBody: string): string {
	const lines = rawBody.split(LINE_SPLIT_REGEX);
	const kept: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (QUOTED_HEADER_REGEX.test(trimmed)) {
			break;
		}
		if (QUOTED_LINE_REGEX.test(trimmed)) {
			continue;
		}
		kept.push(line);
	}
	const cleaned = kept.join("\n").trim();
	return cleaned.length > 0 ? cleaned : rawBody.trim();
}

/** Detect prohibited outbound pricing while ignoring quoted verified funding citations. */
export function detectOutboundPriceViolation(
	text: string,
	citedSpans: string[] = []
): string | null {
	let sanitized = text;
	for (const span of citedSpans) {
		if (span.trim().length > 0) {
			sanitized = sanitized.replaceAll(span, " ");
		}
	}

	const phraseMatch = PRICE_PHRASE_REGEX.exec(sanitized);
	if (phraseMatch) {
		return phraseMatch[0];
	}

	const dollarMatch = PRICE_DOLLAR_REGEX.exec(sanitized);
	if (dollarMatch) {
		return dollarMatch[0];
	}

	return null;
}

/** Detect whether plain-text email copy contains an http(s) or www URL. */
export function hasUrlLink(text: string): boolean {
	return URL_IN_EMAIL_REGEX.test(text);
}

function matchOptOutPatterns(
	text: string,
	patterns: RegExp[]
): { matched: boolean; reason: string | null } {
	const cleaned = stripQuotedReplyText(text);
	if (NEGATED_OPT_OUT_REGEX.test(cleaned)) {
		return { matched: false, reason: null };
	}

	for (const pattern of patterns) {
		const match = pattern.exec(cleaned);
		if (match) {
			return { matched: true, reason: match[0].toLowerCase() };
		}
	}

	return { matched: false, reason: null };
}

/** Deterministic safety net for unambiguous explicit opt-out / unsubscribe / stop demands. */
export function detectHardOptOutIntent(text: string): {
	matched: boolean;
	reason: string | null;
} {
	return matchOptOutPatterns(text, HARD_OPT_OUT_PATTERNS);
}

/** Detect opt-out language (both explicit hard stops and softer declines for offline fallback). */
export function detectOptOutIntent(text: string): {
	matched: boolean;
	reason: string | null;
} {
	const hardMatch = matchOptOutPatterns(text, HARD_OPT_OUT_PATTERNS);
	if (hardMatch.matched) {
		return hardMatch;
	}
	return matchOptOutPatterns(text, SOFT_OPT_OUT_PATTERNS);
}

/** Detect whether the prospect directly asked if they are speaking to an AI or bot. */
export function detectBotQuestion(text: string): boolean {
	const cleaned = stripQuotedReplyText(text);
	return BOT_QUESTION_PATTERNS.some((pattern) => pattern.test(cleaned));
}

/** Verify that a reply clearly discloses Ledgerwise's AI assistant identity when required. */
export function verifyBotDisclosure(replyText: string): boolean {
	return BOT_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(replyText));
}

/** Count words in plain-text email copy. */
export function countEmailWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	return trimmed.split(SPACE_SPLIT_REGEX).length;
}

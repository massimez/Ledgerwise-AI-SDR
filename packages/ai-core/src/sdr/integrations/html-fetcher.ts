import type { RawSourceDocument } from "./sandbox-fixtures";

const SCRIPT_TAG_REGEX = /<script[\s\S]*?<\/script>/giu;
const STYLE_TAG_REGEX = /<style[\s\S]*?<\/style>/giu;
const HTML_TAG_REGEX = /<[^>]+>/gu;
const COLLAPSE_SPACE_REGEX = /\s+/gu;
const PROTOCOL_PREFIX_REGEX = /^https?:\/\//u;
const WWW_PREFIX_REGEX = /^www\./u;

/** Strip HTML markup and collapse whitespace safely for text extraction. */
export function stripHtmlToText(html: string): string {
	return html
		.replace(SCRIPT_TAG_REGEX, " ")
		.replace(STYLE_TAG_REGEX, " ")
		.replace(HTML_TAG_REGEX, " ")
		.replace(COLLAPSE_SPACE_REGEX, " ")
		.trim()
		.slice(0, 12_000);
}

/** Normalize a domain string to bare lowercase host (e.g., `canyongoods.com`). */
export function normalizeDomain(domainOrUrl: string): string {
	const cleaned = domainOrUrl
		.trim()
		.toLowerCase()
		.replace(PROTOCOL_PREFIX_REGEX, "")
		.replace(WWW_PREFIX_REGEX, "");
	const slashIndex = cleaned.indexOf("/");
	return slashIndex === -1 ? cleaned : cleaned.slice(0, slashIndex);
}

/** Fetch a URL safely with timeout and extract plain text. */
export async function fetchPageTextSafe(
	url: string,
	timeoutMs = 5000
): Promise<RawSourceDocument | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: {
				Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
				"User-Agent": "LedgerwiseSDRResearchBot/1.0 (+https://ledgerwise.io)",
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			return null;
		}
		const contentType = response.headers.get("content-type") ?? "";
		const rawText = await response.text();
		const text = contentType.includes("json")
			? rawText.slice(0, 8000)
			: stripHtmlToText(rawText);
		if (text.length < 40) {
			return null;
		}
		return {
			fetchedAt: new Date().toISOString(),
			sourceType: "website",
			text,
			title: url,
			url,
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

import type { RawSourceDocument } from "../shared/types";
import { fetchWithSsrfGuard } from "./ssrf-guard";

export { normalizeDomain } from "../shared/domain";

const SCRIPT_TAG_REGEX = /<script[\s\S]*?<\/script>/giu;
const STYLE_TAG_REGEX = /<style[\s\S]*?<\/style>/giu;
const HTML_TAG_REGEX = /<[^>]+>/gu;
const COLLAPSE_SPACE_REGEX = /\s+/gu;

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

/** Fetch a URL safely with SSRF DNS checks, manual redirect validation, timeout, and byte cap. */
export async function fetchPageTextSafe(
	url: string,
	timeoutMs = 5000
): Promise<RawSourceDocument | null> {
	const fetched = await fetchWithSsrfGuard(url, {
		headers: {
			Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
			"User-Agent": "LedgerwiseSDRResearchBot/1.0 (+https://ledgerwise.io)",
		},
		maxBytes: 512 * 1024,
		maxRedirects: 3,
		timeoutMs,
	});
	if (!fetched) {
		return null;
	}

	const text = fetched.contentType.includes("json")
		? fetched.text.slice(0, 8000)
		: stripHtmlToText(fetched.text);
	if (text.length < 40) {
		return null;
	}

	return {
		fetchedAt: new Date().toISOString(),
		sourceType: "website",
		text,
		title: fetched.finalUrl,
		url: fetched.finalUrl,
	};
}

import type {
	ExtractedEvidenceFact,
	ResearchExtractionOutput,
} from "../agents";
import type { RawSourceDocument } from "../integrations/research";
import type { TriStateSignal } from "../scoring";

const US_INDICATOR_REGEX =
	/\b(?:united states|u\.s\.|us customers|usa|austin,\s*tx|charleston,\s*sc|portland,\s*or|denver,\s*co|nashville,\s*tn|new york|california|texas|florida|chicago|seattle|boston|los angeles)\b/iu;
const ECOM_INDICATOR_REGEX =
	/\b(?:shopify|ecommerce|e-commerce|dtc|direct-to-consumer|storefront|amazon fba|amazon|woocommerce|orders|skus)\b/iu;
const HIRING_FINANCE_REGEX =
	/\b(?:hiring|seeking).{0,45}\b(?:accountant|controller|bookkeeper|finance manager|accounting lead|fp&a|cfo)\b/iu;
const FUNDING_REGEX =
	/\b(?:raised|closed|seed round|series [ab]|funding)\s+(?:a\s+)?\$\d/iu;
const ENTERPRISE_REGEX =
	/\b(?:publicly traded|nasdaq:|nyse:|fortune 500|\b(?:500|1,000|2,000|5,000)\+?\s+employees)\b/iu;
const HEADCOUNT_REGEX =
	/\b(?<team>\d{1,4})[-\s]?person|\b(?<employees>\d{1,4})\s+employees\b/iu;
const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/u;

function pickMatchingSentence(text: string, regex: RegExp): string | null {
	const sentences = text.split(SENTENCE_SPLIT_REGEX);
	for (const sentence of sentences) {
		const trimmed = sentence.trim();
		if (trimmed.length >= 16 && regex.test(trimmed)) {
			return trimmed.slice(0, 260);
		}
	}
	return null;
}

function detectChannelsFromDocs(docs: RawSourceDocument[]): string[] {
	const text = docs.map((doc) => doc.text.toLowerCase()).join("\n");
	const detected = new Set<string>();
	if (text.includes("shopify")) {
		detected.add("shopify");
	}
	if (text.includes("amazon")) {
		detected.add("amazon");
	}
	if (text.includes("wholesale") || text.includes("retailers")) {
		detected.add("wholesale");
	}
	if (text.includes("tiktok shop")) {
		detected.add("tiktok_shop");
	}
	if (text.includes("woocommerce")) {
		detected.add("woocommerce");
	}
	return Array.from(detected);
}

function detectHeadcountBand(text: string): TriStateSignal {
	const match = HEADCOUNT_REGEX.exec(text);
	if (!match) {
		return "unknown";
	}
	const count = Number(
		match.groups?.team ?? match.groups?.employees ?? match[1] ?? "0"
	);
	if (!Number.isFinite(count) || count <= 0) {
		return "unknown";
	}
	return count >= 5 && count <= 50 ? "yes" : "no";
}

function collectDocumentFacts(
	companyName: string,
	doc: RawSourceDocument
): ExtractedEvidenceFact[] {
	const rules: Array<{
		claim: string;
		factType: ExtractedEvidenceFact["factType"];
		regex: RegExp;
	}> = [
		{
			claim: `${companyName} operates from a US location referenced on ${doc.title}.`,
			factType: "us_hq",
			regex: US_INDICATOR_REGEX,
		},
		{
			claim: `${companyName} sells direct-to-consumer products via e-commerce channels.`,
			factType: "ecommerce",
			regex: ECOM_INDICATOR_REGEX,
		},
		{
			claim: `${companyName} has an active finance or accounting job opening.`,
			factType: "hiring",
			regex: HIRING_FINANCE_REGEX,
		},
		{
			claim: `${companyName} recently announced growth funding.`,
			factType: "funding",
			regex: FUNDING_REGEX,
		},
	];

	const extracted: ExtractedEvidenceFact[] = [];
	for (const rule of rules) {
		const quote = pickMatchingSentence(doc.text, rule.regex);
		if (quote) {
			extracted.push({
				claim: rule.claim,
				factType: rule.factType,
				quote,
				sourceTitle: doc.title,
				sourceType: doc.sourceType,
				url: doc.url,
			});
		}
	}
	return extracted;
}

/** Deterministically extract verifiable US e-commerce company signals and quotes from docs. */
export function runDeterministicFactExtraction(options: {
	companyName: string;
	docs: RawSourceDocument[];
}): ResearchExtractionOutput {
	const combinedText = options.docs.map((doc) => doc.text).join("\n");
	const channels = detectChannelsFromDocs(options.docs);
	const facts = options.docs.flatMap((doc) =>
		collectDocumentFacts(options.companyName, doc)
	);

	return {
		channels,
		ecommerceBrand:
			ECOM_INDICATOR_REGEX.test(combinedText) || channels.length > 0,
		employeesInRange: detectHeadcountBand(combinedText),
		enterpriseDisqualifier: ENTERPRISE_REGEX.test(combinedText),
		facts: facts.slice(0, 10),
		revenueInRange: "unknown",
		signalChannelExpansion: channels.length >= 2,
		signalHiringFinanceOps: HIRING_FINANCE_REGEX.test(combinedText),
		signalRecentFunding: FUNDING_REGEX.test(combinedText),
		summary: `${options.companyName} operates ${channels.length > 0 ? channels.join("/") : "e-commerce"} retail channels with ${facts.length} extracted source facts.`,
		usBased: US_INDICATOR_REGEX.test(combinedText),
	};
}

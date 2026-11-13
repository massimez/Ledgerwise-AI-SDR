import { searchExaSources } from "./exa-client";
import { fetchPageTextSafe, normalizeDomain } from "./html-fetcher";
import {
	CURATED_US_ECOMMERCE_PROSPECTS,
	type RawSourceDocument,
} from "./sandbox-fixtures";

const NON_SLUG_CHARS_REGEX = /[^a-z0-9-]/gu;

/** Check public Greenhouse, Lever, and Ashby job boards for finance/accounting openings. */
export async function probeAtsBoards(
	companySlug: string
): Promise<RawSourceDocument[]> {
	const slug = companySlug.toLowerCase().replace(NON_SLUG_CHARS_REGEX, "");
	if (slug.length < 2) {
		return [];
	}

	const urls = [
		`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
		`https://api.lever.co/v0/postings/${slug}?mode=json`,
		`https://api.ashbyhq.com/posting-api/job-board/${slug}`,
	];

	const results = await Promise.all(
		urls.map((url) => fetchPageTextSafe(url, 3500))
	);
	const docs: RawSourceDocument[] = [];
	for (const doc of results) {
		if (doc && (doc.text.includes("title") || doc.text.includes("jobs"))) {
			docs.push({
				...doc,
				sourceType: "ats",
				title: `ATS Job Board (${slug})`,
			});
		}
	}
	return docs;
}

/** Probe a brand's domain for Shopify storefront signals and About page text. */
export async function probeCompanyWebPresence(
	domain: string
): Promise<RawSourceDocument[]> {
	const bare = normalizeDomain(domain);
	const targets = [
		`https://${bare}/pages/about`,
		`https://${bare}/pages/about-us`,
		`https://${bare}`,
		`https://${bare}/products.json?limit=3`,
	];

	const fetched = await Promise.all(
		targets.map((url) => fetchPageTextSafe(url, 4000))
	);
	const docs: RawSourceDocument[] = [];
	for (const doc of fetched) {
		if (doc) {
			docs.push({
				...doc,
				sourceType: doc.url.endsWith("products.json?limit=3")
					? "shopify_probe"
					: "website",
			});
		}
	}
	return docs;
}

/**
 * Collect real evidence documents for a company domain using Exa, direct domain probes,
 * ATS job boards, and curated fallback docs when running in offline sandbox mode.
 */
export async function gatherCompanyResearchDocuments(options: {
	companyName: string;
	domain: string;
	exaApiKey?: string;
	skipLiveNetwork?: boolean;
}): Promise<RawSourceDocument[]> {
	const bareDomain = normalizeDomain(options.domain);
	const curated = CURATED_US_ECOMMERCE_PROSPECTS.find(
		(item) => normalizeDomain(item.domain) === bareDomain
	);

	if (options.skipLiveNetwork) {
		return curated?.seedDocuments ?? [];
	}

	const slug = bareDomain.split(".")[0] ?? "";
	const [exaDocs, webDocs, atsDocs] = await Promise.all([
		searchExaSources({
			apiKey: options.exaApiKey,
			numResults: 5,
			query: `"${options.companyName}" OR site:${bareDomain} ecommerce Shopify Amazon accounting finance`,
		}),
		probeCompanyWebPresence(bareDomain),
		probeAtsBoards(slug),
	]);

	const combined = [...exaDocs, ...webDocs, ...atsDocs];
	if (combined.length > 0) {
		return combined;
	}

	return (
		curated?.seedDocuments ?? [
			{
				fetchedAt: new Date().toISOString(),
				sourceType: "website",
				text: `${options.companyName} (${bareDomain}) operates an online storefront serving customers in the United States.`,
				title: `${options.companyName} Website`,
				url: `https://${bareDomain}/about`,
			},
		]
	);
}

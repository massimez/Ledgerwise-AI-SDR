import {
	extractVerifiedDomainEmailsFromDocs,
	normalizeDomain,
} from "../shared/domain";
import type { RawSourceDocument, SdrPipelineLogger } from "../shared/types";
import { searchExaSources } from "./exa-client";
import { fetchPageTextSafe } from "./html-fetcher";
import { CURATED_US_ECOMMERCE_PROSPECTS } from "./sandbox-fixtures";

const NON_SLUG_CHARS_REGEX = /[^a-z0-9-]/gu;

/** Check public Greenhouse, Lever, and Ashby job boards for finance/accounting openings. */
export async function probeAtsBoards(
	companySlug: string,
	options?: { logger?: SdrPipelineLogger }
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
	options?.logger?.debug?.("SdrSourceGatherer", "Completed ATS board probes", {
		hitUrls: docs.map((d) => d.url),
		probedCount: urls.length,
		slug,
	});
	return docs;
}

/** Probe a brand's domain for Shopify storefront signals, About, Contact, and Privacy pages. */
export async function probeCompanyWebPresence(
	domain: string,
	options?: { logger?: SdrPipelineLogger }
): Promise<RawSourceDocument[]> {
	const bare = normalizeDomain(domain);
	const targets = [
		`https://${bare}/pages/about`,
		`https://${bare}/pages/about-us`,
		`https://${bare}/pages/contact`,
		`https://${bare}/pages/contact-us`,
		`https://${bare}/contact`,
		`https://${bare}/pages/privacy-policy`,
		`https://${bare}/policies/privacy-policy`,
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
	options?.logger?.debug?.(
		"SdrSourceGatherer",
		"Completed web presence probes",
		{
			domain: bare,
			hits: docs.map((d) => ({
				sourceType: d.sourceType,
				textLength: d.text.length,
				url: d.url,
			})),
			probedTargetsCount: targets.length,
		}
	);
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
	logger?: SdrPipelineLogger;
}): Promise<RawSourceDocument[]> {
	const bareDomain = normalizeDomain(options.domain);
	const curated = CURATED_US_ECOMMERCE_PROSPECTS.find(
		(item) => normalizeDomain(item.domain) === bareDomain
	);

	const slug = bareDomain.split(".")[0] ?? "";
	const researchQuery = `"${options.companyName}" OR site:${bareDomain} ecommerce Shopify Amazon accounting finance`;
	const peopleQuery = `"${options.companyName}" ${bareDomain} (Founder OR "Co-Founder" OR CEO OR COO OR CFO OR "Head of Finance" OR Controller OR "VP of Finance")`;
	const [exaDocs, peopleDocs, webDocs, atsDocs] = await Promise.all([
		searchExaSources({
			apiKey: options.exaApiKey,
			logger: options.logger,
			numResults: 5,
			purpose: "company_research",
			query: researchQuery,
		}),
		searchExaSources({
			allowShortText: true,
			apiKey: options.exaApiKey,
			category: "people",
			logger: options.logger,
			numResults: 5,
			purpose: "people_search",
			query: peopleQuery,
		}),
		probeCompanyWebPresence(bareDomain, { logger: options.logger }),
		probeAtsBoards(slug, { logger: options.logger }),
	]);

	const combined = [...exaDocs, ...peopleDocs, ...webDocs, ...atsDocs];
	const detectedDomainEmails = extractVerifiedDomainEmailsFromDocs(
		combined,
		bareDomain
	);

	options.logger?.info(
		"SdrSourceGatherer",
		"Gathered research source documents",
		{
			atsCount: atsDocs.length,
			companyName: options.companyName,
			detectedDomainEmails,
			domain: bareDomain,
			docs: combined.map((doc) => ({
				sourceType: doc.sourceType,
				textLength: doc.text.length,
				url: doc.url,
			})),
			exaCount: exaDocs.length,
			peopleCount: peopleDocs.length,
			totalCount: combined.length,
			webCount: webDocs.length,
		}
	);

	if (combined.length > 0) {
		return combined;
	}

	const curatedFallback = options.exaApiKey
		? undefined
		: curated?.seedDocuments;
	return curatedFallback ?? [];
}

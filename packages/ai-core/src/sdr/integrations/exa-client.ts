import { normalizeDomain } from "./html-fetcher";
import {
	CURATED_US_ECOMMERCE_PROSPECTS,
	type DiscoveredProspectCandidate,
	type RawSourceDocument,
} from "./sandbox-fixtures";

/** Query Exa Search API when EXA_API_KEY is present; returns empty list otherwise. */
export async function searchExaSources(options: {
	apiKey?: string;
	numResults?: number;
	query: string;
}): Promise<RawSourceDocument[]> {
	if (!options.apiKey) {
		return [];
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8000);
	try {
		const response = await fetch("https://api.exa.ai/search", {
			body: JSON.stringify({
				contents: {
					text: { maxCharacters: 4000 },
				},
				numResults: options.numResults ?? 5,
				query: options.query,
				type: "auto",
			}),
			headers: {
				"Content-Type": "application/json",
				"x-api-key": options.apiKey,
			},
			method: "POST",
			signal: controller.signal,
		});

		if (!response.ok) {
			return [];
		}

		const data = (await response.json()) as {
			results?: {
				publishedDate?: string;
				text?: string;
				title?: string;
				url?: string;
			}[];
		};

		const docs: RawSourceDocument[] = [];
		for (const item of data.results ?? []) {
			if (item.url && item.text && item.text.trim().length > 40) {
				docs.push({
					fetchedAt: item.publishedDate ?? new Date().toISOString(),
					sourceType: "exa",
					text: item.text.trim(),
					title: item.title ?? item.url,
					url: item.url,
				});
			}
		}
		return docs;
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

function toCandidateFromExaDoc(
	doc: RawSourceDocument,
	seen: Set<string>
): DiscoveredProspectCandidate | null {
	try {
		const parsedUrl = new URL(doc.url);
		const host = normalizeDomain(parsedUrl.hostname);
		const isBlockedHost =
			host.length < 4 ||
			seen.has(host) ||
			host.includes("linkedin.com") ||
			host.includes("indeed.com");
		if (isBlockedHost) {
			return null;
		}
		seen.add(host);
		const brandLabel = host.split(".")[0] ?? host;
		return {
			channels: ["shopify"],
			domain: host,
			name: brandLabel.charAt(0).toUpperCase() + brandLabel.slice(1),
			seedDocuments: [doc],
		};
	} catch {
		return null;
	}
}

/** Discover candidate US e-commerce companies via Exa or curated fallback batch. */
export async function discoverProspectCandidates(options: {
	exaApiKey?: string;
	existingDomains: Set<string>;
	targetCount: number;
}): Promise<DiscoveredProspectCandidate[]> {
	const results: DiscoveredProspectCandidate[] = [];
	const seen = new Set(
		Array.from(options.existingDomains, (domain) => normalizeDomain(domain))
	);

	if (options.exaApiKey) {
		const exaDocs = await searchExaSources({
			apiKey: options.exaApiKey,
			numResults: Math.min(10, Math.max(3, options.targetCount * 2)),
			query:
				"US Shopify direct-to-consumer ecommerce brand hiring accountant controller Amazon FBA",
		});

		for (const doc of exaDocs) {
			const candidate = toCandidateFromExaDoc(doc, seen);
			if (!candidate) {
				continue;
			}
			results.push(candidate);
			if (results.length >= options.targetCount) {
				return results;
			}
		}
	}

	for (const candidate of CURATED_US_ECOMMERCE_PROSPECTS) {
		const normalized = normalizeDomain(candidate.domain);
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		results.push({
			...candidate,
			contactFirstName: candidate.contactFirstName
				? candidate.contactFirstName.charAt(0).toUpperCase() +
					candidate.contactFirstName.slice(1)
				: undefined,
		});
		if (results.length >= options.targetCount) {
			break;
		}
	}

	return results;
}

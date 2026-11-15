import type { RawSourceDocument, SdrPipelineLogger } from "../../shared/types";
import {
	EXA_DISCOVERY_EXCLUDED_JOB_BOARD_HOSTS,
	sanitizeCompanyDomain,
} from "./domain-matching";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MAX_CHARACTERS = 4000;
export const DISCOVERY_EXA_NUM_RESULTS = 25;
const MAX_EXCLUDE_DOMAINS = 200;
const EXA_MIN_REQUEST_INTERVAL_MS = 160;
const EXA_MAX_RATE_LIMIT_RETRIES = 2;
const EXA_RATE_LIMIT_DEFAULT_DELAY_MS = 1150;
export const EXA_LOOKUP_CONCURRENCY = 3;

interface ExaRawResultItem {
	publishedDate?: string;
	text?: string;
	title?: string;
	url?: string;
}

export interface ExaSearchTelemetryEvent {
	costUsd: number;
	latencyMs: number;
	numResults: number;
	purpose: string;
	query: string;
}

const EXA_BASE_SEARCH_COST_USD = 0.007;
const EXA_EXTRA_RESULT_COST_USD = 0.001;
const STALE_ARCHIVE_YEAR_PATH_REGEX = /\/(?:201\d|202[0-4])\//u;

let activeExaTelemetryCallback:
	| ((event: ExaSearchTelemetryEvent) => void)
	| null = null;

/** Calculate exact 2026 Exa /search (auto) cost: $0.007 base (<=10 results) + $0.001 per result above 10. */
export function calculateExaSearchCostUsd(numResults: number): number {
	const extraResults = Math.max(0, Math.trunc(numResults) - 10);
	return Number(
		(
			EXA_BASE_SEARCH_COST_USD +
			extraResults * EXA_EXTRA_RESULT_COST_USD
		).toFixed(6)
	);
}

/** Register or clear a global telemetry listener for Exa /search invocations. */
export function configureExaTelemetry(
	callback: ((event: ExaSearchTelemetryEvent) => void) | null
): void {
	activeExaTelemetryCallback = callback;
}

function isResultStaleForCutoff(
	item: ExaRawResultItem,
	cutoffMs: number | null
): boolean {
	if (cutoffMs === null) {
		return false;
	}
	if (item.url && STALE_ARCHIVE_YEAR_PATH_REGEX.test(item.url)) {
		return true;
	}
	if (!item.publishedDate) {
		return false;
	}
	const publishedMs = Date.parse(item.publishedDate);
	return Number.isFinite(publishedMs) && publishedMs < cutoffMs;
}

function parseExaSearchResults(
	rawResults: ExaRawResultItem[],
	allowShortText?: boolean,
	startPublishedDate?: string
): RawSourceDocument[] {
	const minTextLen = allowShortText ? 0 : 40;
	const cutoffMs = startPublishedDate
		? Date.parse(startPublishedDate)
		: Number.NaN;
	const validCutoffMs = Number.isFinite(cutoffMs) ? cutoffMs : null;
	const docs: RawSourceDocument[] = [];
	for (const item of rawResults) {
		if (!item.url || isResultStaleForCutoff(item, validCutoffMs)) {
			continue;
		}
		const trimmedText = item.text?.trim() ?? "";
		if (trimmedText.length > minTextLen || allowShortText) {
			docs.push({
				fetchedAt: item.publishedDate ?? new Date().toISOString(),
				sourceType: "exa",
				text: trimmedText || item.title?.trim() || item.url,
				title: item.title ?? item.url,
				url: item.url,
			});
		}
	}
	return docs;
}

/**
 * Build the `excludeDomains` list sent to Exa `/search` during discovery:
 * excludes known job-board/aggregator domains (while keeping ATS hosts searchable)
 * plus already-discovered company domains.
 */
export function buildDiscoveryExcludeDomains(
	existingDomains: Iterable<string>
): string[] {
	const excluded = new Set<string>(EXA_DISCOVERY_EXCLUDED_JOB_BOARD_HOSTS);
	for (const raw of existingDomains) {
		if (excluded.size >= MAX_EXCLUDE_DOMAINS) {
			break;
		}
		const clean = sanitizeCompanyDomain(raw);
		if (clean) {
			excluded.add(clean);
		}
	}
	return Array.from(excluded);
}

function buildExaRequestBody(options: {
	category?: string;
	excludeDomains?: string[];
	numResults: number;
	query: string;
	startPublishedDate?: string;
}) {
	return {
		...(options.category ? { category: options.category } : {}),
		contents: {
			text: { maxCharacters: EXA_MAX_CHARACTERS },
		},
		...(options.excludeDomains && options.excludeDomains.length > 0
			? { excludeDomains: options.excludeDomains }
			: {}),
		numResults: options.numResults,
		query: options.query,
		...(options.startPublishedDate
			? { startPublishedDate: options.startPublishedDate }
			: {}),
		type: "auto",
	};
}

function sleepMs(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let exaRateLimitChain: Promise<void> = Promise.resolve();
let nextAllowedExaRequestAt = 0;

/** Serialize Exa request starts under ~6.25 req/s to stay below Exa's 10 req/s team ceiling. */
function scheduleExaRequestSlot(): Promise<void> {
	if (process.env.NODE_ENV === "test") {
		return Promise.resolve();
	}
	const scheduled = exaRateLimitChain.then(async () => {
		const now = Date.now();
		const waitMs = Math.max(0, nextAllowedExaRequestAt - now);
		nextAllowedExaRequestAt =
			Math.max(now, nextAllowedExaRequestAt) + EXA_MIN_REQUEST_INTERVAL_MS;
		if (waitMs > 0) {
			await sleepMs(waitMs);
		}
	});
	exaRateLimitChain = scheduled.catch(() => undefined);
	return scheduled;
}

function resolveExaRetryDelayMs(response: Response, attempt: number): number {
	if (process.env.NODE_ENV === "test") {
		return 5;
	}
	const retryAfterHeader = response.headers.get("retry-after");
	const retryAfterSeconds = retryAfterHeader
		? Number(retryAfterHeader)
		: Number.NaN;
	if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
		return Math.min(5000, Math.ceil(retryAfterSeconds * 1000) + 100);
	}
	return EXA_RATE_LIMIT_DEFAULT_DELAY_MS * (attempt + 1);
}

async function fetchExaWithRetry(params: {
	apiKey: string;
	attempt: number;
	category?: string;
	logger?: SdrPipelineLogger;
	purpose: string;
	query: string;
	requestBody: ReturnType<typeof buildExaRequestBody>;
}): Promise<{ latencyMs: number; response: Response } | null> {
	await scheduleExaRequestSlot();
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch(EXA_SEARCH_URL, {
			body: JSON.stringify(params.requestBody),
			headers: {
				"Content-Type": "application/json",
				"x-api-key": params.apiKey,
			},
			method: "POST",
			signal: controller.signal,
		});
		const latencyMs = Date.now() - startedAt;

		if (
			(response.status === 429 || response.status === 503) &&
			params.attempt < EXA_MAX_RATE_LIMIT_RETRIES
		) {
			const retryDelayMs = resolveExaRetryDelayMs(response, params.attempt);
			const errorBody = (await response.text().catch(() => "")).slice(0, 300);
			params.logger?.warn("ExaSearch", "Exa rate-limited; scheduling retry", {
				attempt: params.attempt + 1,
				category: params.category ?? null,
				errorBody,
				latencyMs,
				purpose: params.purpose,
				query: params.query,
				retryDelayMs,
				status: response.status,
			});
			await sleepMs(retryDelayMs);
			return await fetchExaWithRetry({
				...params,
				attempt: params.attempt + 1,
			});
		}

		return { latencyMs, response };
	} catch (error) {
		params.logger?.warn("ExaSearch", "Exa search request failed", {
			category: params.category ?? null,
			error: error instanceof Error ? error.message : String(error),
			latencyMs: Date.now() - startedAt,
			purpose: params.purpose,
			query: params.query,
		});
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Query Exa Search API when EXA_API_KEY is present (rate-limited with 429 retries); returns empty list otherwise. */
export async function searchExaSources(options: {
	allowShortText?: boolean;
	apiKey?: string;
	category?: string;
	excludeDomains?: string[];
	logger?: SdrPipelineLogger;
	numResults?: number;
	purpose?:
		| "discovery"
		| "company_research"
		| "company_domain_lookup"
		| "people_search";
	query: string;
	startPublishedDate?: string;
}): Promise<RawSourceDocument[]> {
	const purpose = options.purpose ?? "discovery";
	const numResults = options.numResults ?? 5;
	const excludeDomainsCount = options.excludeDomains?.length ?? 0;

	if (!options.apiKey) {
		options.logger?.info(
			"ExaSearch",
			"Skipping Exa request (EXA_API_KEY unset)",
			{
				category: options.category ?? null,
				excludeDomainsCount,
				numResults,
				purpose,
				query: options.query,
				startPublishedDate: options.startPublishedDate ?? null,
			}
		);
		return [];
	}

	const requestBody = buildExaRequestBody({
		category: options.category,
		excludeDomains: options.excludeDomains,
		numResults,
		query: options.query,
		startPublishedDate: options.startPublishedDate,
	});

	options.logger?.info("ExaSearch", "Sending Exa search request", {
		category: options.category ?? null,
		excludeDomainsCount,
		headers: {
			"Content-Type": "application/json",
			// Never log raw API keys
			"x-api-key": "[REDACTED]",
		},
		maxCharacters: EXA_MAX_CHARACTERS,
		method: "POST",
		numResults,
		purpose,
		query: options.query,
		startPublishedDate: options.startPublishedDate ?? null,
		type: requestBody.type,
		url: EXA_SEARCH_URL,
	});

	const fetchOutcome = await fetchExaWithRetry({
		apiKey: options.apiKey,
		attempt: 0,
		category: options.category,
		logger: options.logger,
		purpose,
		query: options.query,
		requestBody,
	});
	if (!fetchOutcome) {
		return [];
	}

	const { latencyMs, response } = fetchOutcome;
	if (!response.ok) {
		const errorBody = (await response.text().catch(() => "")).slice(0, 500);
		options.logger?.warn("ExaSearch", "Exa search returned non-OK status", {
			category: options.category ?? null,
			errorBody,
			latencyMs,
			purpose,
			query: options.query,
			status: response.status,
			statusText: response.statusText,
		});
		return [];
	}

	const data = (await response.json()) as {
		results?: ExaRawResultItem[];
	};
	const rawResults = data.results ?? [];
	const docs = parseExaSearchResults(
		rawResults,
		options.allowShortText,
		options.startPublishedDate
	);

	activeExaTelemetryCallback?.({
		costUsd: calculateExaSearchCostUsd(numResults),
		latencyMs,
		numResults,
		purpose,
		query: options.query,
	});

	options.logger?.info("ExaSearch", "Received Exa search response", {
		acceptedDocsCount: docs.length,
		category: options.category ?? null,
		latencyMs,
		purpose,
		query: options.query,
		rawResultCount: rawResults.length,
		results: rawResults.slice(0, 10).map((item) => ({
			publishedDate: item.publishedDate ?? null,
			textLength: item.text?.trim().length ?? 0,
			textPreview: (item.text?.trim() ?? "").slice(0, 180),
			title: item.title ?? null,
			url: item.url ?? null,
		})),
		status: response.status,
	});

	return docs;
}

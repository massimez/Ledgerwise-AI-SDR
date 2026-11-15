import { DISCOVERY_NICHES, type DiscoveryNicheId } from "../../../contracts";

const MAX_DISCOVERY_QUERY_PASSES = 2;

export type DiscoverySignalPreset =
	| "hiring_finance_ops"
	| "recent_funding"
	| "channel_expansion";

const SIGNAL_PRESET_QUERY_TEMPLATES: Record<DiscoverySignalPreset, string> = {
	channel_expansion:
		"US {niche} DTC Shopify ecommerce brand expanding Amazon FBA wholesale retail 3PL",
	hiring_finance_ops:
		"US {niche} growing founder-led indie DTC Shopify ecommerce brand small team hiring Bookkeeper Staff Accountant Accounting Manager Finance & Operations Manager",
	recent_funding:
		"US {niche} DTC Shopify ecommerce brand raised seed series A funding",
};

const DEFAULT_DISCOVERY_QUERY_TEMPLATE =
	"US {niche} growing founder-led indie Shopify direct-to-consumer ecommerce brand small team hiring Bookkeeper Staff Accountant Accounting Manager Finance & Operations Manager Amazon FBA";

const SIGNAL_PRESET_LOOKBACK_DAYS: Record<DiscoverySignalPreset, number> = {
	channel_expansion: 365,
	hiring_finance_ops: 180,
	recent_funding: 270,
};

const MS_PER_DAY = 86_400_000;

/**
 * Compute dynamic ISO 8601 `startPublishedDate` cutoff for time-sensitive discovery
 * presets (6–12 months ago) so Exa returns only genuinely recent signals.
 */
export function resolveDiscoveryStartPublishedDate(
	signalPreset?: DiscoverySignalPreset,
	now: Date = new Date()
): string | undefined {
	if (!signalPreset) {
		return undefined;
	}
	const lookbackDays = SIGNAL_PRESET_LOOKBACK_DAYS[signalPreset];
	return new Date(now.getTime() - lookbackDays * MS_PER_DAY).toISOString();
}

function appendKeywordToQuery(base: string, keyword?: string): string {
	const trimmed = keyword?.trim();
	if (!trimmed) {
		return base;
	}
	if (base.toLowerCase().includes(trimmed.toLowerCase())) {
		return base;
	}
	return `${base} ${trimmed}`;
}

/**
 * Build rotated / least-used verticalized query variations (8 niches per `signalPreset`)
 * so consecutive discovery runs explore fresh brands instead of repeating the same top 10.
 */
export function buildDiscoveryQueryVariations(options: {
	keyword?: string;
	niche?: DiscoveryNicheId;
	recentQueries?: string[];
	rotationSeed?: number;
	signalPreset?: DiscoverySignalPreset;
}): string[] {
	const template = options.signalPreset
		? SIGNAL_PRESET_QUERY_TEMPLATES[options.signalPreset]
		: DEFAULT_DISCOVERY_QUERY_TEMPLATE;

	const rawVariations = DISCOVERY_NICHES.map((niche) => ({
		id: niche.id,
		query: appendKeywordToQuery(
			template.replace("{niche}", niche.terms),
			options.keyword
		),
	}));

	const recentUsage = new Map<string, number>();
	for (const recent of options.recentQueries ?? []) {
		const norm = recent.trim().toLowerCase();
		if (norm) {
			recentUsage.set(norm, (recentUsage.get(norm) ?? 0) + 1);
		}
	}

	const count = rawVariations.length;
	const offset =
		options.rotationSeed === undefined
			? Math.floor(Math.random() * count)
			: ((Math.trunc(options.rotationSeed) % count) + count) % count;

	const indexed = rawVariations.map((item, idx) => ({
		...item,
		rotatedRank: (idx - offset + count) % count,
		usageCount: recentUsage.get(item.query.toLowerCase()) ?? 0,
	}));

	indexed.sort((a, b) => {
		if (options.niche) {
			if (a.id === options.niche && b.id !== options.niche) {
				return -1;
			}
			if (b.id === options.niche && a.id !== options.niche) {
				return 1;
			}
		}
		if (a.usageCount !== b.usageCount) {
			return a.usageCount - b.usageCount;
		}
		return a.rotatedRank - b.rotatedRank;
	});

	return indexed.map((item) => item.query);
}

export function buildDiscoverySearchQuery(options: {
	keyword?: string;
	niche?: DiscoveryNicheId;
	queries?: string[];
	recentQueries?: string[];
	rotationSeed?: number;
	signalPreset?: DiscoverySignalPreset;
}): string {
	const explicitQuery = options.queries?.find((q) => q.trim().length > 0);
	if (explicitQuery) {
		return appendKeywordToQuery(explicitQuery, options.keyword);
	}
	return (
		buildDiscoveryQueryVariations(options)[0] ??
		DEFAULT_DISCOVERY_QUERY_TEMPLATE.replace("{niche} ", "")
	);
}

export function buildDiscoveryQueryPlan(options: {
	keyword?: string;
	niche?: DiscoveryNicheId;
	queries?: string[];
	recentQueries?: string[];
	rotationSeed?: number;
	signalPreset?: DiscoverySignalPreset;
}): string[] {
	const plan: string[] = [];
	const seenQueries = new Set<string>();
	const pushUnique = (raw: string) => {
		const trimmed = raw.trim();
		const key = trimmed.toLowerCase();
		if (
			trimmed &&
			!seenQueries.has(key) &&
			plan.length < MAX_DISCOVERY_QUERY_PASSES
		) {
			seenQueries.add(key);
			plan.push(trimmed);
		}
	};

	for (const explicit of options.queries ?? []) {
		pushUnique(appendKeywordToQuery(explicit, options.keyword));
	}
	for (const variation of buildDiscoveryQueryVariations(options)) {
		pushUnique(variation);
	}
	return plan;
}

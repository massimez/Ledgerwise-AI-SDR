export {
	buildDiscoveryExcludeDomains,
	buildDiscoveryQueryVariations,
	buildDiscoverySearchQuery,
	calculateExaSearchCostUsd,
	configureExaTelemetry,
	type DiscoverProspectsOptions,
	type DiscoveryBatchResult,
	type DiscoveryBatchSummary,
	type DiscoverySignalPreset,
	type DiscoverySkipReason,
	discoverProspectBatch,
	discoverProspectCandidates,
	doesCompanyNameMatchHostname,
	type ExaSearchTelemetryEvent,
	isThirdPartySignalHost,
	resolveDiscoveryStartPublishedDate,
	type SkippedDiscoveryResult,
	sanitizeCompanyDomain,
	searchExaSources,
} from "./exa-client";
export {
	fetchPageTextSafe,
	normalizeDomain,
	stripHtmlToText,
} from "./html-fetcher";
export type {
	DiscoveredProspectCandidate,
	RawSourceDocument,
} from "./sandbox-fixtures";
export {
	gatherCompanyResearchDocuments,
	probeAtsBoards,
	probeCompanyWebPresence,
} from "./source-gatherer";
export {
	assertPublicHttpUrl,
	fetchWithSsrfGuard,
	SsrfBlockedError,
} from "./ssrf-guard";

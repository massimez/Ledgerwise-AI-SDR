export {
	type DiscoverProspectsOptions,
	type DiscoveryBatchResult,
	type DiscoveryBatchSummary,
	type DiscoverySkipReason,
	discoverProspectBatch,
	discoverProspectCandidates,
	type SkippedDiscoveryResult,
} from "./exa/discover-candidates";
export {
	doesCompanyNameMatchHostname,
	isThirdPartySignalHost,
	sanitizeCompanyDomain,
} from "./exa/domain-matching";
export {
	buildDiscoveryExcludeDomains,
	calculateExaSearchCostUsd,
	configureExaTelemetry,
	type ExaSearchTelemetryEvent,
	searchExaSources,
} from "./exa/http-client";
export {
	buildDiscoveryQueryVariations,
	buildDiscoverySearchQuery,
	type DiscoverySignalPreset,
	resolveDiscoveryStartPublishedDate,
} from "./exa/query-planner";

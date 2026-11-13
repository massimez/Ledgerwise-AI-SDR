export {
	discoverProspectCandidates,
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

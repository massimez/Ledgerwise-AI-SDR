import { DIACRITICS_REGEX, normalizeDomain } from "../../shared/domain";
import type { RawSourceDocument } from "../../shared/types";

const COMPANY_TAGLINE_SPLIT_REGEX = /\s+(?:-|–|—|\|)\s+/u;

const ATS_SIGNAL_HOSTS = [
	"greenhouse.io",
	"lever.co",
	"ashbyhq.com",
	"workable.com",
	"bamboohr.com",
	"breezy.hr",
	"rippling.com",
	"smartrecruiters.com",
	"icims.com",
	"jobvite.com",
	"paylocity.com",
	"adp.com",
	"workday.com",
	"myworkdayjobs.com",
	"recruitee.com",
	"jazzhr.com",
	"applytojob.com",
	"pinpointhq.com",
	"teamtailor.com",
	"gem.com",
] as const;

export const EXA_DISCOVERY_EXCLUDED_JOB_BOARD_HOSTS = [
	"univision.com",
	"a16z.com",
	"linkedin.com",
	"indeed.com",
	"glassdoor.com",
	"wellfound.com",
	"angel.co",
	"builtin.com",
	"builtinnyc.com",
	"builtinsf.com",
	"builtinaustin.com",
	"builtinchicago.com",
	"builtinla.com",
	"builtinboston.com",
	"builtinseattle.com",
	"builtincolorado.com",
	"simplify.jobs",
	"ziprecruiter.com",
	"monster.com",
	"simplyhired.com",
	"themuse.com",
	"otta.com",
	"welcometothejungle.com",
	"remotive.com",
	"weworkremotely.com",
	"workatastartup.com",
	"hired.com",
	"rrm.com",
	"ecom.jobs",
	"jobrack.eu",
	"zunohire.com",
	"meterwork.com",
	"jobsearcher.com",
	"opentoworkremote.com",
	"career.io",
	"reddit.com",
	"x.com",
	"twitter.com",
	"youtube.com",
	"instagram.com",
	"facebook.com",
	"tiktok.com",
	"wikipedia.org",
] as const;

const THIRD_PARTY_SIGNAL_HOSTS = [
	...ATS_SIGNAL_HOSTS,
	...EXA_DISCOVERY_EXCLUDED_JOB_BOARD_HOSTS,
	"ycombinator.com",
	"techcrunch.com",
	"prnewswire.com",
	"businesswire.com",
	"globenewswire.com",
	"forbes.com",
	"bloomberg.com",
	"reuters.com",
	"crunchbase.com",
	"pitchbook.com",
	"zoominfo.com",
	"dnb.com",
	"apollo.io",
	"rocketreach.co",
	"craft.co",
	"owler.com",
	"cbinsights.com",
	"tracxn.com",
	"yelp.com",
	"bbb.org",
	"manta.com",
	"comparably.com",
	"ambitionbox.com",
	"builtwith.com",
	"similarweb.com",
	"sec.gov",
	"finance.yahoo.com",
	"pinterest.com",
	"medium.com",
	"substack.com",
	"prweb.com",
	"accesswire.com",
	"newswire.com",
	"einpresswire.com",
	"modernretail.co",
	"glossy.co",
	"beautyindependent.com",
	"bevnet.com",
	"nosh.com",
	"fooddive.com",
	"retaildive.com",
	"wwd.com",
	"inc.com",
	"fastcompany.com",
	"fortune.com",
	"entrepreneur.com",
	"axios.com",
	"finsmes.com",
	"bizjournals.com",
	"vcnewsdaily.com",
	"alleywatch.com",
] as const;

const NON_PROSPECT_VENDOR_HOSTS = [
	"shopify.com",
	"myshopify.com",
	"intuit.com",
	"xero.com",
	"netsuite.com",
	"oracle.com",
	"amazon.com",
	"stripe.com",
	"paypal.com",
	"klaviyo.com",
	"gorgias.com",
	"shipbob.com",
	"google.com",
	"apple.com",
	"microsoft.com",
	"meta.com",
	"w3.org",
	"schema.org",
	"cloudflare.com",
	"amazonaws.com",
] as const;

const DOMAIN_VALID_REGEX =
	/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const DOMAIN_STRIP_SUFFIX_REGEX = /[?#:].*$/u;
export const HIRING_ORG_JSONLD_REGEX =
	/"hiringOrganization"\s*:\s*\{(?<block>[\s\S]{0,600}?)\}/iu;
export const JSONLD_NAME_REGEX = /"name"\s*:\s*"(?<name>[^"]{2,120})"/iu;
export const JSONLD_URL_REGEX =
	/"(?:sameAs|url)"\s*:\s*"(?<url>https?:\/\/[^"\s]+)"/iu;
export const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>()]+/giu;
export const EMAIL_IN_TEXT_REGEX =
	/[A-Za-z0-9._%+-]+@(?<host>[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gu;
export const JOB_BOARD_TITLE_SUFFIX_REGEX =
	/\s*(?:\||—|–|-)\s*(?:Greenhouse|Workable|Breezy(?:\s*HR)?|Wellfound|Built\s*In(?:\s+\w+)?|Lever|Ashby|LinkedIn|Indeed|ZipRecruiter|Careers|Jobs)\s*$/iu;
export const AT_COMPANY_TITLE_REGEX =
	/\bat\s+(?<company>[A-Z0-9][^|\n—–-]{1,80})/u;
export const NON_ALNUM_SEP_REGEX = /[-_]+/gu;
const APOSTROPHE_REGEX = /['’]/gu;
const NON_ALNUM_SPACE_REGEX = /[^a-z0-9]+/gu;
const AMPERSAND_REGEX = /&/gu;
const DIRECTORY_TITLE_HINT_REGEX =
	/\b(?:company profile|stock price|competitors|revenue,\s*location|org chart|linkedin|zoominfo|crunchbase)\b/iu;
const DIRECTORY_PATH_HINT_REGEX =
	/^\/(?:company|companies|organization|organizations|profile|employer|employers|business)\b/iu;

const SECOND_LEVEL_TLDS = new Set(["co", "com", "org", "net", "edu", "gov"]);

const PLACEHOLDER_COMPANY_NAMES = new Set([
	"unknown",
	"unknown company",
	"n/a",
	"na",
	"none",
]);

const LEGAL_SUFFIX_TOKENS = new Set([
	"inc",
	"incorporated",
	"llc",
	"llp",
	"ltd",
	"limited",
	"corp",
	"corporation",
	"co",
	"company",
	"plc",
	"gmbh",
	"sa",
	"pty",
	"ag",
	"nv",
	"bv",
]);

const GENERIC_COMPANY_TOKENS = new Set([
	"the",
	"and",
	"of",
	"for",
	"by",
	"in",
	"on",
	"at",
	"to",
	"from",
	"with",
	"a",
	"an",
	"brand",
	"brands",
	"group",
	"holdings",
	"holding",
	"international",
	"global",
	"usa",
	"us",
	"america",
	"american",
	"shop",
	"store",
	"official",
	"online",
	"direct",
	"ecommerce",
	"retail",
	"studio",
	"labs",
	"lab",
	"goods",
	"products",
	"services",
	"solutions",
	"ventures",
	"partners",
	"collective",
	"industries",
	"supply",
	"works",
	"design",
	"designs",
	"fashion",
	"apparel",
	"beauty",
	"skincare",
	"home",
	"pet",
	"pets",
	"food",
	"foods",
	"coffee",
	"roasters",
	"tea",
	"botanicals",
	"athletic",
	"athletica",
	"wear",
	"clothing",
	"accessories",
	"jewelry",
	"wellness",
	"health",
	"care",
	"kids",
	"baby",
	"family",
	"living",
	"market",
	"club",
	"house",
	"society",
	"project",
	"media",
	"digital",
]);

interface NormalizedCompanyIdentity {
	coreTokens: string[];
	distinctiveTokens: string[];
	phrases: string[];
	slugs: string[];
}

function normalizeForCompanyMatch(input: string): string {
	return input
		.normalize("NFD")
		.replace(DIACRITICS_REGEX, "")
		.toLowerCase()
		.replace(APOSTROPHE_REGEX, "")
		.replace(NON_ALNUM_SPACE_REGEX, " ")
		.trim();
}

function extractNormalizedCompanyIdentity(
	companyName: string
): NormalizedCompanyIdentity | null {
	const cleaned = normalizeForCompanyMatch(companyName);
	if (!cleaned || PLACEHOLDER_COMPANY_NAMES.has(cleaned)) {
		return null;
	}
	const rawTokens = cleaned.split(" ").filter(Boolean);
	if (rawTokens.length === 0) {
		return null;
	}
	const nonLegalTokens = rawTokens.filter(
		(token) => !LEGAL_SUFFIX_TOKENS.has(token)
	);
	const coreTokens = nonLegalTokens.length > 0 ? nonLegalTokens : rawTokens;
	const distinctiveTokens = coreTokens.filter(
		(token) => !GENERIC_COMPANY_TOKENS.has(token) && token.length >= 3
	);

	const phrases = new Set<string>([coreTokens.join(" ")]);
	const slugs = new Set<string>([coreTokens.join("")]);
	const taglineParts = companyName
		.split(COMPANY_TAGLINE_SPLIT_REGEX)
		.map((part) => part.trim())
		.filter(Boolean);
	if (taglineParts.length >= 2 && taglineParts[0]) {
		const prefixTokens = normalizeForCompanyMatch(taglineParts[0])
			.split(" ")
			.filter((token) => token && !LEGAL_SUFFIX_TOKENS.has(token));
		if (prefixTokens.length > 0) {
			phrases.add(prefixTokens.join(" "));
			slugs.add(prefixTokens.join(""));
		}
	}
	if (companyName.includes("&")) {
		const withAnd = normalizeForCompanyMatch(
			companyName.replace(AMPERSAND_REGEX, " and ")
		);
		const andTokens = withAnd
			.split(" ")
			.filter((token) => token && !LEGAL_SUFFIX_TOKENS.has(token));
		if (andTokens.length > 0) {
			phrases.add(andTokens.join(" "));
			slugs.add(andTokens.join(""));
		}
	}

	return {
		coreTokens,
		distinctiveTokens,
		phrases: Array.from(phrases),
		slugs: Array.from(slugs),
	};
}

/**
 * Return true when a company's normalized name shares a meaningful slug or
 * distinctive token with the target hostname (e.g. "Birdy Grey" -> "birdygrey.com").
 */
export function doesCompanyNameMatchHostname(
	companyName: string,
	hostname: string
): boolean {
	const identity = extractNormalizedCompanyIdentity(companyName);
	const host = normalizeDomain(hostname);
	if (!(identity && host)) {
		return false;
	}

	const parts = host.split(".").filter(Boolean);
	let nonTldParts = parts;
	if (parts.length >= 3 && SECOND_LEVEL_TLDS.has(parts.at(-2) ?? "")) {
		nonTldParts = parts.slice(0, -2);
	} else if (parts.length >= 2) {
		nonTldParts = parts.slice(0, -1);
	}

	const hostBaseTokens = nonTldParts
		.flatMap((part) => part.split(NON_ALNUM_SPACE_REGEX))
		.filter(Boolean);
	const hostCompact = nonTldParts.join("").replace(NON_ALNUM_SPACE_REGEX, "");
	if (!hostCompact) {
		return false;
	}

	if (
		identity.slugs.some(
			(slug) =>
				(slug.length >= 4 && hostCompact.includes(slug)) ||
				(slug.length >= 2 && hostBaseTokens.includes(slug))
		)
	) {
		return true;
	}

	if (identity.distinctiveTokens.length === 1) {
		const [only] = identity.distinctiveTokens;
		if (!only) {
			return false;
		}
		return (
			hostBaseTokens.includes(only) ||
			hostCompact === only ||
			(only.length >= 5 && hostCompact.includes(only))
		);
	}

	if (identity.distinctiveTokens.length >= 2) {
		return identity.distinctiveTokens.every(
			(token) =>
				hostBaseTokens.includes(token) ||
				hostCompact === token ||
				(token.length >= 4 && hostCompact.includes(token))
		);
	}

	return false;
}

export function doesTextReferToCompany(
	companyName: string,
	text: string
): boolean {
	const identity = extractNormalizedCompanyIdentity(companyName);
	const normalizedText = normalizeForCompanyMatch(text);
	if (!(identity && normalizedText)) {
		return false;
	}

	const textTokens = new Set(normalizedText.split(" ").filter(Boolean));
	const textCompact = normalizedText.replaceAll(" ", "");

	if (
		identity.phrases.some(
			(phrase) => phrase.length >= 4 && normalizedText.includes(phrase)
		) ||
		identity.slugs.some(
			(slug) => slug.length >= 5 && textCompact.includes(slug)
		)
	) {
		return true;
	}

	if (identity.distinctiveTokens.length > 0) {
		return identity.distinctiveTokens.every(
			(token) =>
				textTokens.has(token) ||
				(token.length >= 5 && textCompact.includes(token))
		);
	}

	return identity.coreTokens.every((token) => textTokens.has(token));
}

export function looksLikeThirdPartyDirectoryDoc(
	doc: Pick<RawSourceDocument, "title" | "url">
): boolean {
	if (DIRECTORY_TITLE_HINT_REGEX.test(doc.title)) {
		return true;
	}
	try {
		const { pathname } = new URL(doc.url);
		return DIRECTORY_PATH_HINT_REGEX.test(pathname);
	} catch {
		return false;
	}
}

function hostMatchesList(host: string, list: readonly string[]): boolean {
	return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Return true if hostname belongs to a third-party ATS, job board, news, or social host. */
export function isThirdPartySignalHost(host: string): boolean {
	const normalized = normalizeDomain(host);
	return hostMatchesList(normalized, THIRD_PARTY_SIGNAL_HOSTS);
}

/** Normalize an extracted candidate domain and reject third-party/vendor/invalid hosts. */
export function sanitizeCompanyDomain(
	rawDomain: string | null | undefined
): string | null {
	if (!rawDomain) {
		return null;
	}
	const cleaned = normalizeDomain(rawDomain).replace(
		DOMAIN_STRIP_SUFFIX_REGEX,
		""
	);
	if (
		cleaned.length < 4 ||
		!DOMAIN_VALID_REGEX.test(cleaned) ||
		isThirdPartySignalHost(cleaned) ||
		hostMatchesList(cleaned, NON_PROSPECT_VENDOR_HOSTS)
	) {
		return null;
	}
	return cleaned;
}

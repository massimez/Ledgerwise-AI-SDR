import type {
	ExtractedEvidenceFact,
	ResearchExtractionOutput,
} from "../agents";
import { verifyQuoteAgainstSource } from "../guards";
import type { TriStateSignal } from "../scoring";
import {
	DIACRITICS_REGEX,
	extractVerifiedDomainEmailsFromDocs,
	isGenericMailboxEmail,
	normalizeDomain,
} from "../shared/domain";
import type { RawSourceDocument } from "../shared/types";

export { verifyEmailInDocs } from "../shared/domain";

const DECISION_MAKER_ROLE_REGEX =
	/\b(?:founder|co-?founder|owner|president|managing director|general manager|ceo|chief executive|coo|chief operating|cfo|chief financial|chief accounting|vp(?:[,\s-]+(?:of\s+)?)?(?:finance|accounting|operations)|vice president(?:[,\s-]+(?:of\s+)?)?(?:finance|accounting|operations)|head of (?:finance|accounting|operations)|director of (?:finance|accounting|operations)|controller|finance\s+(?:&\s+operations\s+)?(?:lead|director|manager)|accounting\s+(?:lead|director|manager)|bookkeep(?:er|ing)\s+(?:lead|manager))\b/iu;
const LINKEDIN_PERSONAL_PROFILE_REGEX = /linkedin\.com\/in\//iu;
const WHITESPACE_SPLIT_REGEX = /\s+/u;
const NON_COMPANY_HEADCOUNT_CLAUSE_REGEX =
	/\b(?:clients?|customers?|brands?|merchants?|stores?|partners?|portfolio\s+companies?|previously\s+at|prior\s+to|former(?:ly)?\s+at)\b[^.!?\n]{0,80}\b(?:employees|ftes?|staff|team\s+members|people)\b/giu;
const PLACEHOLDER_NAME_REGEX =
	/^(?:unknown|finance lead|decision maker|team|contact|customer|n\/a|na|none)$/iu;
const NON_ALPHA_REGEX = /[^a-z]/gu;
const LINKEDIN_PERSON_TITLE_REGEX =
	/^(?<first>[A-Z][a-zA-Z'-]{1,30})\s+(?<last>[A-Z][a-zA-Z'-]{1,30})(?:\s+[^-–|@\s]+)*?(?:\s+[-–@]\s+|\s*\|\s*)(?<role>.+?)(?:\s+[-–@]\s+|\s+at\s+|\s*\||$)/u;

const US_INDICATOR_REGEX =
	/\b(?:united states|u\.s\.|us customers|usa|austin,\s*tx|charleston,\s*sc|portland,\s*or|denver,\s*co|nashville,\s*tn|new york|california|texas|florida|chicago|seattle|boston|los angeles)\b/iu;
const ECOM_INDICATOR_REGEX =
	/\b(?:shopify|ecommerce|e-commerce|dtc|direct-to-consumer|storefront|amazon fba|amazon|woocommerce|orders|skus)\b/iu;
const HIRING_FINANCE_REGEX =
	/\b(?:hiring|seeking).{0,45}\b(?:staff\s+accountant|accountant|controller|bookkeeper|accounting\s+manager|finance\s+(?:&|and)\s+operations\s+manager|finance\s+manager|accounting\s+lead|finance\s+ops|fp&a|cfo)\b/iu;
const FUNDING_REGEX =
	/\b(?:raised|closed|seed round|series [ab]|funding)\s+(?:a\s+)?\$\d/iu;
const ENTERPRISE_REGEX =
	/\b(?:publicly traded|nasdaq:|nyse:|fortune 500|\b(?:500|1,000|2,000|5,000)\+?\s+employees)\b/iu;
const MIN_ICP_EMPLOYEES = 5;
const MAX_ICP_EMPLOYEES = 50;
const ENTERPRISE_EMPLOYEE_THRESHOLD = 250;

const HEADCOUNT_RANGE_UNIT_REGEX =
	/\b(?<min>\d{1,3}(?:,\d{3})*)\s*(?:-|–|to)\s*(?<max>\d{1,3}(?:,\d{3})*)\s*\+?\s*(?:(?:full[-\s]?time|part[-\s]?time|total|current|active|us)\s+)?(?:employees|ftes?|staff|team\s+members|people)\b/giu;
const HEADCOUNT_LABELED_RANGE_REGEX =
	/\b(?:employees|headcount|company\s+size|team\s+size)\s*(?::|-|–|\n)\s*(?<min>\d{1,3}(?:,\d{3})*)\s*(?:-|–|to)\s*(?<max>\d{1,3}(?:,\d{3})*)\b/giu;
const HEADCOUNT_LOWER_BOUND_REGEX =
	/\b(?<count>\d{1,3}(?:,\d{3})*)\s*\+\s*(?:(?:full[-\s]?time|part[-\s]?time|total|current|active|us)\s+)?(?:employees|ftes?|staff|team\s+members|people)\b/giu;
const HEADCOUNT_OVER_REGEX =
	/\b(?:over|more\s+than|above|exceeding|>)\s+(?<count>\d{1,3}(?:,\d{3})*)\s+(?:(?:full[-\s]?time|part[-\s]?time|total|current|active|us)\s+)?(?:employees|ftes?|staff|team\s+members|people)\b/giu;
const HEADCOUNT_EXACT_UNIT_REGEX =
	/\b(?<count>\d{1,3}(?:,\d{3})*)\s+(?:(?:full[-\s]?time|part[-\s]?time|total|current|active|us)\s+)?(?:employees|ftes?|staff|team\s+members)\b/giu;
const HEADCOUNT_LABELED_EXACT_REGEX =
	/\b(?:employees|headcount|company\s+size|team\s+size)\s*(?<sep>:|-|–|\n)\s*(?<count>\d{1,3}(?:,\d{3})*)\b/giu;
const HEADCOUNT_TEAM_PHRASE_REGEX =
	/\b(?:team\s+(?:of|grew\s+to)|has)\s+(?<count>\d{1,3}(?:,\d{3})*)\s+(?:people|employees|staff|team\s+members)\b/giu;
const HEADCOUNT_PERSON_REGEX =
	/\b(?<count>\d{1,3}(?:,\d{3})*)[-\s]?person\b/giu;
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

interface HeadcountObservation {
	enterprise: boolean;
	priority: 1 | 2;
	signal: TriStateSignal;
}

function parseCommaInt(raw: string | undefined): number | null {
	if (!raw) {
		return null;
	}
	const parsed = Number(raw.replaceAll(",", ""));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function maskMatches(
	input: string,
	regex: RegExp,
	onMatch?: (match: RegExpMatchArray) => void
): string {
	const chars = Array.from(input);
	for (const match of input.matchAll(regex)) {
		onMatch?.(match);
		const start = match.index ?? 0;
		const end = start + match[0].length;
		for (let i = start; i < end; i += 1) {
			chars[i] = " ";
		}
	}
	return chars.join("");
}

function classifyRangeBounds(min: number, max: number): TriStateSignal {
	if (min > MAX_ICP_EMPLOYEES || max < MIN_ICP_EMPLOYEES) {
		return "no";
	}
	if (min >= MIN_ICP_EMPLOYEES && max <= MAX_ICP_EMPLOYEES) {
		return "yes";
	}
	return "unknown";
}

function classifyExactCount(count: number): TriStateSignal {
	return count >= MIN_ICP_EMPLOYEES && count <= MAX_ICP_EMPLOYEES
		? "yes"
		: "no";
}

function collectHeadcountObservations(text: string): HeadcountObservation[] {
	const observations: HeadcountObservation[] = [];

	const recordRange = (match: RegExpMatchArray) => {
		const rawMin = parseCommaInt(match.groups?.min);
		const rawMax = parseCommaInt(match.groups?.max);
		if (rawMin === null || rawMax === null) {
			return;
		}
		const min = Math.min(rawMin, rawMax);
		const max = Math.max(rawMin, rawMax);
		observations.push({
			enterprise: min > ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 1,
			signal: classifyRangeBounds(min, max),
		});
	};

	const sanitizedText = maskMatches(text, NON_COMPANY_HEADCOUNT_CLAUSE_REGEX);
	let masked = maskMatches(
		sanitizedText,
		HEADCOUNT_RANGE_UNIT_REGEX,
		recordRange
	);
	masked = maskMatches(masked, HEADCOUNT_LABELED_RANGE_REGEX, recordRange);

	masked = maskMatches(masked, HEADCOUNT_LOWER_BOUND_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		observations.push({
			enterprise: count >= ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 1,
			signal: count > MAX_ICP_EMPLOYEES ? "no" : "unknown",
		});
	});

	masked = maskMatches(masked, HEADCOUNT_OVER_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		observations.push({
			enterprise: count >= ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 1,
			signal: count >= MAX_ICP_EMPLOYEES ? "no" : "unknown",
		});
	});

	masked = maskMatches(masked, HEADCOUNT_EXACT_UNIT_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		observations.push({
			enterprise: count > ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 1,
			signal: classifyExactCount(count),
		});
	});

	masked = maskMatches(masked, HEADCOUNT_LABELED_EXACT_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		const sep = match.groups?.sep ?? "";
		// Ignore newline-separated year headings like "Employees\n2026".
		if (sep === "\n" && count >= 1990 && count <= 2035) {
			return;
		}
		observations.push({
			enterprise: count > ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 1,
			signal: classifyExactCount(count),
		});
	});

	masked = maskMatches(masked, HEADCOUNT_TEAM_PHRASE_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		observations.push({
			enterprise: count > ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 2,
			signal: classifyExactCount(count),
		});
	});

	maskMatches(masked, HEADCOUNT_PERSON_REGEX, (match) => {
		const count = parseCommaInt(match.groups?.count);
		if (count === null) {
			return;
		}
		observations.push({
			enterprise: count > ENTERPRISE_EMPLOYEE_THRESHOLD,
			priority: 2,
			signal: classifyExactCount(count),
		});
	});

	return observations;
}

/**
 * Evaluate strict 5–50 employee bounds across source texts, giving precedence
 * to explicit company headcount indicators (`employees`, `FTEs`, `headcount`).
 */
export function analyzeHeadcountFromTexts(texts: string[]): {
	employeesInRange: TriStateSignal;
	enterpriseHeadcount: boolean;
} {
	const observations = texts.flatMap((text) =>
		collectHeadcountObservations(text)
	);
	const enterpriseHeadcount = observations.some((obs) => obs.enterprise);

	const pickFromPriority = (priority: 1 | 2): TriStateSignal => {
		const scoped = observations.filter((obs) => obs.priority === priority);
		if (scoped.some((obs) => obs.signal === "no")) {
			return "no";
		}
		if (scoped.some((obs) => obs.signal === "yes")) {
			return "yes";
		}
		return "unknown";
	};

	const explicitSignal = pickFromPriority(1);
	if (explicitSignal !== "unknown") {
		return { employeesInRange: explicitSignal, enterpriseHeadcount };
	}

	return {
		employeesInRange: pickFromPriority(2),
		enterpriseHeadcount,
	};
}

/** Detect strict 5–50 employee range signal from text. */
export function detectHeadcountBand(text: string): TriStateSignal {
	return analyzeHeadcountFromTexts([text]).employeesInRange;
}

/** Return true when URL points to a personal LinkedIn profile (`linkedin.com/in/*`). */
export function isLinkedInPersonalProfileUrl(url: string): boolean {
	return LINKEDIN_PERSONAL_PROFILE_REGEX.test(url);
}

/**
 * Evaluate strict numeric bounds (5 <= employees <= 50) against company-level docs,
 * extracted headcount facts, and grounded LLM `reportedEmployeeCount`, excluding
 * personal `linkedin.com/in/*` bios so prior-employer headcounts never bleed into company ICP.
 */
export function resolveEmployeesInRange(options: {
	docs: RawSourceDocument[];
	employeeCountQuote?: string | null;
	facts?: ExtractedEvidenceFact[];
	llmEmployeesInRange: TriStateSignal;
	reportedEmployeeCount?: number | null;
}): {
	employeesInRange: TriStateSignal;
	enterpriseHeadcount: boolean;
} {
	const companyDocs = options.docs.filter(
		(doc) => !isLinkedInPersonalProfileUrl(doc.url)
	);
	const companyFacts = (options.facts ?? []).filter(
		(fact) =>
			fact.factType === "headcount" && !isLinkedInPersonalProfileUrl(fact.url)
	);
	const texts = [
		...companyDocs.map((doc) => `${doc.title}\n${doc.text}`),
		...companyFacts.map((fact) => `${fact.claim}\n${fact.quote}`),
	];
	const analysis = analyzeHeadcountFromTexts(texts);

	let groundedLlmSignal: TriStateSignal = "unknown";
	let groundedLlmEnterprise = false;
	if (
		typeof options.reportedEmployeeCount === "number" &&
		Number.isFinite(options.reportedEmployeeCount) &&
		options.reportedEmployeeCount > 0
	) {
		const count = Math.round(options.reportedEmployeeCount);
		const quoteText = options.employeeCountQuote?.trim();
		const isGrounded = quoteText
			? companyDocs.some((doc) => verifyQuoteAgainstSource(quoteText, doc.text))
			: companyDocs.some((doc) =>
					new RegExp(`\\b${count}\\b`, "u").test(`${doc.title}\n${doc.text}`)
				);
		if (isGrounded) {
			groundedLlmSignal = classifyExactCount(count);
			groundedLlmEnterprise = count > ENTERPRISE_EMPLOYEE_THRESHOLD;
		}
	}

	const resolveSignal = (): TriStateSignal => {
		if (analysis.employeesInRange === "no" || groundedLlmSignal === "no") {
			return "no";
		}
		if (groundedLlmSignal === "yes") {
			return "yes";
		}
		if (analysis.employeesInRange !== "unknown") {
			return analysis.employeesInRange;
		}
		return options.llmEmployeesInRange;
	};

	return {
		employeesInRange: resolveSignal(),
		enterpriseHeadcount: analysis.enterpriseHeadcount || groundedLlmEnterprise,
	};
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

/** Return true if the title/role represents a relevant Founder, Executive, or Finance decision-maker. */
export function isDecisionMakerRole(role?: string | null): boolean {
	if (!role) {
		return false;
	}
	return DECISION_MAKER_ROLE_REGEX.test(role.trim());
}

/** Return true when a contact name is empty or a synthetic placeholder label. */
export function isGenericPlaceholderName(name?: string | null): boolean {
	if (!name) {
		return true;
	}
	const trimmed = name.trim();
	return trimmed.length === 0 || PLACEHOLDER_NAME_REGEX.test(trimmed);
}

/** Return true when a contact represents an identified human decision-maker (not an unnamed generic inbox). */
export function hasQualifiedDecisionMakerContact(
	contact:
		| {
				email?: string | null;
				firstName?: string | null;
				fullName?: string | null;
				isDecisionMaker?: boolean | null;
				lastName?: string | null;
				persona?: string | null;
				role?: string | null;
				title?: string | null;
		  }
		| null
		| undefined
): boolean {
	if (!contact) {
		return false;
	}
	const name =
		contact.fullName?.trim() ||
		`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
	if (isGenericPlaceholderName(name)) {
		return false;
	}
	if (contact.isDecisionMaker === true) {
		return true;
	}
	const roleText = contact.role ?? contact.title;
	if (isDecisionMakerRole(roleText)) {
		return true;
	}
	return (
		contact.persona === "founder" ||
		contact.persona === "coo" ||
		contact.persona === "finance"
	);
}

/** Derive a `first.last@domain` corporate email candidate for an identified decision-maker. */
export function derivePatternContactEmail(options: {
	domain: string;
	firstName?: string | null;
	lastName?: string | null;
}): string | undefined {
	const bareDomain = normalizeDomain(options.domain);
	if (
		!bareDomain ||
		isGenericPlaceholderName(options.firstName) ||
		isGenericPlaceholderName(options.lastName)
	) {
		return undefined;
	}
	const cleanFirst = (options.firstName ?? "")
		.normalize("NFD")
		.replace(DIACRITICS_REGEX, "")
		.toLowerCase()
		.replace(NON_ALPHA_REGEX, "");
	const cleanLast = (options.lastName ?? "")
		.normalize("NFD")
		.replace(DIACRITICS_REGEX, "")
		.toLowerCase()
		.replace(NON_ALPHA_REGEX, "");
	if (cleanFirst.length < 2 || cleanLast.length < 2) {
		return undefined;
	}
	const candidate = `${cleanFirst}.${cleanLast}@${bareDomain}`;
	return isGenericMailboxEmail(candidate) ? undefined : candidate;
}

function extractDeterministicPeopleContact(
	docs: RawSourceDocument[],
	companyName?: string
): ResearchExtractionOutput["contact"] {
	const companyToken = (companyName ?? "")
		.toLowerCase()
		.split(WHITESPACE_SPLIT_REGEX)
		.find((token) => token.length >= 3);
	const candidates: NonNullable<ResearchExtractionOutput["contact"]>[] = [];
	for (const doc of docs) {
		if (!isLinkedInPersonalProfileUrl(doc.url)) {
			continue;
		}
		const match = LINKEDIN_PERSON_TITLE_REGEX.exec(doc.title.trim());
		const role = match?.groups?.role?.trim();
		const firstName = match?.groups?.first?.trim();
		const lastName = match?.groups?.last?.trim();
		if (firstName && lastName && isDecisionMakerRole(role)) {
			const candidate = {
				firstName,
				lastName,
				linkedinUrl: doc.url,
				role,
			};
			if (
				companyToken &&
				`${doc.title}\n${doc.text}`.toLowerCase().includes(companyToken)
			) {
				return candidate;
			}
			candidates.push(candidate);
		}
	}
	return candidates[0];
}

/** Pick the highest-priority verbatim non-generic email for the company domain from fetched docs. */
export function pickBestDomainContactEmail(
	docs: RawSourceDocument[],
	domain: string
): string | undefined {
	return extractVerifiedDomainEmailsFromDocs(docs, domain)[0];
}

/** Deterministically extract verifiable US e-commerce company signals and quotes from company docs (excluding personal LinkedIn bios). */
export function runDeterministicFactExtraction(options: {
	companyName: string;
	docs: RawSourceDocument[];
	domain?: string;
}): ResearchExtractionOutput {
	const companyDocs = options.docs.filter(
		(doc) => !isLinkedInPersonalProfileUrl(doc.url)
	);
	const combinedText = companyDocs.map((doc) => doc.text).join("\n");
	const channels = detectChannelsFromDocs(companyDocs);
	const facts = companyDocs.flatMap((doc) =>
		collectDocumentFacts(options.companyName, doc)
	);
	const contactEmail = options.domain
		? pickBestDomainContactEmail(options.docs, options.domain)
		: undefined;
	const peopleContact = extractDeterministicPeopleContact(
		options.docs,
		options.companyName
	);
	const mergedContact =
		peopleContact || contactEmail
			? {
					...peopleContact,
					...(contactEmail ? { email: contactEmail } : {}),
				}
			: undefined;

	const headcountAnalysis = resolveEmployeesInRange({
		docs: companyDocs,
		facts,
		llmEmployeesInRange: "unknown",
	});

	return {
		channels,
		...(mergedContact ? { contact: mergedContact } : {}),
		ecommerceBrand:
			ECOM_INDICATOR_REGEX.test(combinedText) || channels.length > 0,
		employeesInRange: headcountAnalysis.employeesInRange,
		enterpriseDisqualifier:
			ENTERPRISE_REGEX.test(combinedText) ||
			headcountAnalysis.enterpriseHeadcount,
		facts: facts.slice(0, 10),
		revenueInRange: "unknown",
		signalChannelExpansion: channels.length >= 2,
		signalHiringFinanceOps: HIRING_FINANCE_REGEX.test(combinedText),
		signalRecentFunding: FUNDING_REGEX.test(combinedText),
		summary: `${options.companyName} operates ${channels.length > 0 ? channels.join("/") : "e-commerce"} retail channels with ${facts.length} extracted source facts.`,
		usBased: US_INDICATOR_REGEX.test(combinedText),
	};
}

import type { RawSourceDocument } from "./types";

const PROTOCOL_PREFIX_REGEX = /^https?:\/\//u;
const WWW_PREFIX_REGEX = /^www\./u;
const EMAIL_IN_TEXT_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const TRAILING_DIGITS_REGEX = /\d+$/u;
const GENERIC_MAILBOX_SEPARATORS_REGEX = /[._+-]+/u;
const GENERIC_MAILBOX_LOCALPART_REGEX =
	/^(?:help|helpme|helpdesk|hello|hi|hey|info|infodesk|support|contact|contactus|talktous|talk|privacy|dataprotection|dpo|sales|careers|jobs|recruiting|talent|hr|team|admin|press|media|marketing|customercare|customerservice|customersupport|service|concierge|orders|order|billing|accounts|ap|ar|legal|compliance|security|returns|refunds|shipping|fulfillment|wholesale|affiliates|affiliate|partners|partner|partnerships|pr|social|community|events|investors|ir|shop|store|studio|studios|skincarestudio|cs|care|office|general|feedback|inquiries|enquiries|inquiry|enquiry|welcome|newsletter|news|notifications|notify|alerts|vip|webmaster|hostmaster|abuse|dmca|copyright|editorial|donations|sponsorships|vendor|vendors|accessibility|appointments|booking|bookings|reservations|retail|b2b|distribution)$/iu;
const GENERIC_MAILBOX_COMPOUND_SUFFIX_REGEX =
	/(?:studio|support|service|helpdesk|customercare|customerservice|customersupport|inquiries|enquiries|concierge|wholesale|affiliates|partnerships)$/iu;
const GENERIC_MAILBOX_SEGMENT_WORDS = new Set([
	"abuse",
	"accessibility",
	"account",
	"accounts",
	"admin",
	"affiliate",
	"affiliates",
	"alert",
	"alerts",
	"appointments",
	"b2b",
	"billing",
	"booking",
	"bookings",
	"care",
	"career",
	"careers",
	"community",
	"compliance",
	"concierge",
	"contact",
	"cs",
	"customer",
	"customers",
	"data",
	"desk",
	"distribution",
	"donations",
	"dpo",
	"editorial",
	"enquiries",
	"enquiry",
	"events",
	"feedback",
	"fulfillment",
	"general",
	"hello",
	"help",
	"hr",
	"info",
	"inquiries",
	"inquiry",
	"investor",
	"investors",
	"jobs",
	"legal",
	"mail",
	"marketing",
	"me",
	"media",
	"news",
	"newsletter",
	"noreply",
	"notifications",
	"notify",
	"office",
	"order",
	"orders",
	"partner",
	"partners",
	"partnerships",
	"policy",
	"pr",
	"press",
	"privacy",
	"program",
	"protection",
	"recruiting",
	"refunds",
	"relations",
	"reply",
	"requests",
	"reservations",
	"retail",
	"returns",
	"sales",
	"security",
	"service",
	"services",
	"shipping",
	"shop",
	"skincare",
	"social",
	"sponsorships",
	"store",
	"studio",
	"studios",
	"support",
	"talent",
	"team",
	"unsubscribe",
	"us",
	"vendor",
	"vendors",
	"vip",
	"webmaster",
	"welcome",
	"wholesale",
]);
const IGNORED_EMAIL_LOCALPART_REGEX =
	/^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|example|test|user|email)$/iu;
const IGNORED_EMAIL_EXT_REGEX =
	/\.(?:png|jpe?g|gif|svg|webp|ico|css|js|json|woff2?)$/iu;
const TRAILING_PUNCT_REGEX = /[.,;:]+$/u;

export const DIACRITICS_REGEX = /[\u0300-\u036f]/gu;
export const PRIORITY_ROLE_LOCALPART_REGEX =
	/founder|ceo|cfo|controller|finance|accounting|coo/u;

/** Normalize a domain string to bare lowercase host (e.g., `canyongoods.com`). */
export function normalizeDomain(domainOrUrl: string): string {
	const cleaned = domainOrUrl
		.trim()
		.toLowerCase()
		.replace(PROTOCOL_PREFIX_REGEX, "")
		.replace(WWW_PREFIX_REGEX, "");
	const slashIndex = cleaned.indexOf("/");
	return slashIndex === -1 ? cleaned : cleaned.slice(0, slashIndex);
}

/** Return true when the mailbox is a generic team/role inbox rather than an individual address. */
export function isGenericMailboxEmail(email: string): boolean {
	const rawLocalPart = email.trim().split("@")[0]?.toLowerCase() ?? "";
	const normalized = rawLocalPart.replace(TRAILING_DIGITS_REGEX, "");
	if (!normalized) {
		return false;
	}
	if (
		GENERIC_MAILBOX_LOCALPART_REGEX.test(normalized) ||
		IGNORED_EMAIL_LOCALPART_REGEX.test(normalized) ||
		GENERIC_MAILBOX_COMPOUND_SUFFIX_REGEX.test(normalized)
	) {
		return true;
	}
	const segments = normalized
		.split(GENERIC_MAILBOX_SEPARATORS_REGEX)
		.filter(Boolean);
	return (
		segments.length > 0 &&
		segments.every((segment) =>
			GENERIC_MAILBOX_SEGMENT_WORDS.has(
				segment.replace(TRAILING_DIGITS_REGEX, "")
			)
		)
	);
}

/** Return true if the exact email appears verbatim (case-insensitive) inside any fetched doc. */
export function verifyEmailInDocs(
	email: string,
	docs: RawSourceDocument[]
): boolean {
	const normalized = email.trim().toLowerCase();
	if (!normalized.includes("@")) {
		return false;
	}
	return docs.some((doc) => doc.text.toLowerCase().includes(normalized));
}

function scoreDomainEmailCandidate(email: string): number {
	const localPart = (email.split("@")[0] ?? "").toLowerCase();
	if (PRIORITY_ROLE_LOCALPART_REGEX.test(localPart)) {
		return 100;
	}
	if (!isGenericMailboxEmail(email)) {
		return 80;
	}
	return 10;
}

/**
 * Extract unique valid individual (non-generic) email addresses verbatim from fetched docs
 * whose host matches the company's domain (exact match or subdomain).
 */
export function extractVerifiedDomainEmailsFromDocs(
	docs: RawSourceDocument[],
	domain: string
): string[] {
	const bareDomain = normalizeDomain(domain);
	if (!bareDomain) {
		return [];
	}

	const found = new Set<string>();
	for (const doc of docs) {
		const matches = doc.text.match(EMAIL_IN_TEXT_REGEX) ?? [];
		for (const rawEmail of matches) {
			const email = rawEmail.toLowerCase().replace(TRAILING_PUNCT_REGEX, "");
			const parts = email.split("@");
			const localPart = parts[0] ?? "";
			const host = parts[1] ?? "";
			if (!(localPart && host) || IGNORED_EMAIL_EXT_REGEX.test(email)) {
				continue;
			}
			if (
				IGNORED_EMAIL_LOCALPART_REGEX.test(localPart) ||
				isGenericMailboxEmail(email)
			) {
				continue;
			}
			const matchesCompanyDomain =
				host === bareDomain || host.endsWith(`.${bareDomain}`);
			if (matchesCompanyDomain) {
				found.add(email);
			}
		}
	}

	return Array.from(found).sort(
		(a, b) => scoreDomainEmailCandidate(b) - scoreDomainEmailCandidate(a)
	);
}

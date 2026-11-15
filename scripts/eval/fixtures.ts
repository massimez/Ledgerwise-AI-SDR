import { readFileSync } from "node:fs";
import type {
	RawSourceDocument,
	VerifiedEvidenceCandidate,
} from "../../packages/ai-core/src/index";

export interface LabeledIcpBenchmarkCase {
	category: "true_icp_fit" | "true_disqualification";
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	expectedQualified: boolean;
	id: string;
	trickyNote: string;
}

export interface QualifiedLeadEmailFixture {
	companyName: string;
	contactFirstName: string;
	contactRole: string;
	domain: string;
	evidence: VerifiedEvidenceCandidate[];
	id: string;
	signalKeywords: string[];
	signalPreset: "hiring_finance_ops" | "recent_funding" | "channel_expansion";
}

export interface InboundReplyEvalFixture {
	category:
		| "pricing_refusal"
		| "opt_out"
		| "bot_disclosure"
		| "human_escalation"
		| "calendar_booking";
	companyDomain: string;
	companyName: string;
	contactEmail: string;
	contactName: string;
	contactRole: string;
	id: string;
	inboundBodyTemplate: string;
	mode: "standard" | "offer_slots" | "book_selected_slot";
}

interface ExaBenchmarkRecord {
	category: "true_icp_fit" | "true_disqualification";
	companyName: string;
	docs: RawSourceDocument[];
	domain: string;
	expectedQualified: boolean;
	trickyNote: string;
}

const ICP_BENCHMARK_ORDER: Array<{ domain: string; id: string }> = [
	{ domain: "uprootclean.com", id: "icp-fit-01" },
	{ domain: "calderalab.com", id: "icp-fit-02" },
	{ domain: "south40snacks.com", id: "icp-fit-03" },
	{ domain: "rhinousainc.com", id: "icp-fit-04" },
	{ domain: "herbalgoodnessco.com", id: "icp-fit-05" },
	{ domain: "rhonutrition.com", id: "icp-fit-06" },
	{ domain: "baskandlatherco.com", id: "icp-fit-07" },
	{ domain: "farmtopettreats.com", id: "icp-fit-08" },
	{ domain: "nakednutrition.com", id: "icp-dq-01" },
	{ domain: "petiteplume.com", id: "icp-dq-02" },
	{ domain: "onnit.com", id: "icp-dq-03" },
	{ domain: "paired.com", id: "icp-dq-04" },
	{ domain: "pairedsourcing.com", id: "icp-dq-05" },
	{ domain: "nutrafol.com", id: "icp-dq-06" },
	{ domain: "patrickta.com", id: "icp-dq-07" },
];

const exaBenchmarkDocs = JSON.parse(
	readFileSync(
		new URL("./exa-icp-benchmark-docs.json", import.meta.url),
		"utf8"
	)
) as Record<string, ExaBenchmarkRecord>;

/**
 * 15 real Exa-fetched ICP benchmark cases (8 qualified US DTC brands + 7 disqualified).
 */
export const LABELED_ICP_BENCHMARK_CASES: LabeledIcpBenchmarkCase[] =
	ICP_BENCHMARK_ORDER.map(({ domain, id }) => {
		const entry = exaBenchmarkDocs[domain];
		if (!entry) {
			throw new Error(`Missing Exa benchmark docs for ${domain}`);
		}
		return {
			category: entry.category,
			companyName: entry.companyName,
			docs: entry.docs,
			domain: entry.domain,
			expectedQualified: entry.expectedQualified,
			id,
			trickyNote: entry.trickyNote,
		};
	});

interface SnapshotCompany {
	domain: string;
	id: string;
	name: string;
	signals: string[];
}

interface SnapshotContact {
	companyId: string;
	email: string;
	fullName: string;
	title: string;
}

interface SnapshotEvidence {
	claim: string;
	companyId: string;
	id: string;
	kind: string;
	quote: string;
	title: string;
	url: string;
}

interface SnapshotFile {
	companies: SnapshotCompany[];
	contacts: SnapshotContact[];
	evidence: SnapshotEvidence[];
}

const seedSnapshot = JSON.parse(
	readFileSync(
		new URL("../../packages/db/src/seed-sdr-snapshot.json", import.meta.url),
		"utf8"
	)
) as SnapshotFile;

function mapSnapshotKindToFactType(
	kind: string
): VerifiedEvidenceCandidate["factType"] {
	if (kind === "job_posting") {
		return "hiring";
	}
	if (kind === "funding") {
		return "funding";
	}
	if (kind === "marketplace") {
		return "channel";
	}
	return "ecommerce";
}

function mapSnapshotKindToSourceType(
	kind: string
): VerifiedEvidenceCandidate["sourceType"] {
	if (kind === "job_posting") {
		return "ats";
	}
	if (kind === "funding") {
		return "press";
	}
	if (kind === "fingerprint") {
		return "shopify_probe";
	}
	if (kind === "news") {
		return "exa";
	}
	return "website";
}

function mapSignalPreset(
	signals: string[]
): QualifiedLeadEmailFixture["signalPreset"] {
	if (signals.includes("hiring_finance_ops")) {
		return "hiring_finance_ops";
	}
	if (signals.includes("recent_funding")) {
		return "recent_funding";
	}
	return "channel_expansion";
}

const SIGNAL_STOPWORDS = new Set([
	"about",
	"across",
	"along",
	"also",
	"annual",
	"around",
	"based",
	"between",
	"brand",
	"california",
	"company",
	"count",
	"direct",
	"employees",
	"employs",
	"florida",
	"founder",
	"headquartered",
	"illinois",
	"multiple",
	"online",
	"operates",
	"people",
	"products",
	"range",
	"reports",
	"sells",
	"serves",
	"states",
	"texas",
	"their",
	"total",
	"united",
	"using",
	"washington",
]);

const TOKEN_SPLIT_REGEX = /[^a-z0-9+]+/iu;
const WHITESPACE_SPLIT_REGEX = /\s+/u;

function deriveSignalKeywords(
	evidenceList: VerifiedEvidenceCandidate[],
	signalPreset: QualifiedLeadEmailFixture["signalPreset"]
): string[] {
	const corpus = evidenceList
		.map((item) => `${item.claim} ${item.quote}`.toLowerCase())
		.join(" ");
	const tokens = new Set<string>();
	for (const token of corpus.split(TOKEN_SPLIT_REGEX)) {
		if (token.length >= 4 && !SIGNAL_STOPWORDS.has(token)) {
			tokens.add(token);
		}
	}
	if (signalPreset === "hiring_finance_ops") {
		tokens.add("hiring");
		tokens.add("finance");
	}
	if (signalPreset === "recent_funding") {
		tokens.add("funding");
		tokens.add("raised");
	}
	if (signalPreset === "channel_expansion") {
		tokens.add("shopify");
		tokens.add("retail");
	}
	return [...tokens].slice(0, 10);
}

const EMAIL_EVAL_LEAD_DOMAINS: Array<{
	domain: string;
	id: string;
	signalPresetOverride?: QualifiedLeadEmailFixture["signalPreset"];
}> = [
	{ domain: "uprootclean.com", id: "email-01" },
	{ domain: "calderalab.com", id: "email-02" },
	{ domain: "south40snacks.com", id: "email-03" },
	{
		domain: "vacachips.com",
		id: "email-04",
		signalPresetOverride: "recent_funding",
	},
	{ domain: "herbalgoodnessco.com", id: "email-05" },
	{ domain: "rhonutrition.com", id: "email-06" },
	{ domain: "baskandlatherco.com", id: "email-07" },
	{
		domain: "farmtopettreats.com",
		id: "email-08",
		signalPresetOverride: "recent_funding",
	},
	{ domain: "flybyjing.com", id: "email-09" },
	{ domain: "zootsports.com", id: "email-10" },
];

/**
 * 10 real Exa-researched qualified leads grounded in verified evidence from `seed-sdr-snapshot.json`.
 */
export const QUALIFIED_LEAD_EMAIL_FIXTURES: QualifiedLeadEmailFixture[] =
	EMAIL_EVAL_LEAD_DOMAINS.map(({ domain, id, signalPresetOverride }) => {
		const company = seedSnapshot.companies.find(
			(item) => item.domain === domain
		);
		if (!company) {
			throw new Error(`Missing company in seed-sdr-snapshot.json: ${domain}`);
		}
		const contact = seedSnapshot.contacts.find(
			(item) => item.companyId === company.id
		);
		if (!contact) {
			throw new Error(`Missing contact in seed-sdr-snapshot.json: ${domain}`);
		}
		const evidence = seedSnapshot.evidence
			.filter((item) => item.companyId === company.id)
			.map((item) => ({
				claim: item.claim,
				factType: mapSnapshotKindToFactType(item.kind),
				id: item.id,
				quote: item.quote,
				sourceTitle: item.title,
				sourceType: mapSnapshotKindToSourceType(item.kind),
				url: item.url,
				verified: true as const,
			}));
		const signalPreset =
			signalPresetOverride ?? mapSignalPreset(company.signals);
		const firstName =
			contact.fullName.trim().split(WHITESPACE_SPLIT_REGEX)[0] || "there";

		return {
			companyName: company.name,
			contactFirstName: firstName,
			contactRole: contact.title,
			domain: company.domain,
			evidence,
			id,
			signalKeywords: deriveSignalKeywords(evidence, signalPreset),
			signalPreset,
		};
	});

interface ReplyProspectMeta {
	companyDomain: string;
	companyName: string;
	contactName: string;
	contactRole: string;
}

const REPLY_PROSPECTS = {
	bask: {
		companyDomain: "baskandlatherco.com",
		companyName: "Bask & Lather Co.",
		contactName: "Shaina Rainford",
		contactRole: "Chief Executive Officer",
	},
	caldera: {
		companyDomain: "calderalab.com",
		companyName: "Caldera + Lab",
		contactName: "Dylan White",
		contactRole: "EVP of Finance & Operations",
	},
	curlfriend: {
		companyDomain: "curlfriendcollective.com",
		companyName: "Curlfriend Collective",
		contactName: "Chloe Homan",
		contactRole: "CEO & Founder",
	},
	farm: {
		companyDomain: "farmtopettreats.com",
		companyName: "Farm to Pet",
		contactName: "Jackson Jones",
		contactRole: "Founder & CEO",
	},
	flyby: {
		companyDomain: "flybyjing.com",
		companyName: "Fly By Jing",
		contactName: "Jing Gao",
		contactRole: "Founder & CEO",
	},
	goodjanes: {
		companyDomain: "goodjanes.com",
		companyName: "GoodJanes",
		contactName: "Janelle Friedman",
		contactRole: "Founder & CEO",
	},
	rho: {
		companyDomain: "rhonutrition.com",
		companyName: "Rho Nutrition",
		contactName: "Ryan Bishop",
		contactRole: "CEO & Co-Founder",
	},
	south40: {
		companyDomain: "south40snacks.com",
		companyName: "South 40 Snacks",
		contactName: "Josh Schroeter",
		contactRole: "CEO & Co-Founder",
	},
	uproot: {
		companyDomain: "uprootclean.com",
		companyName: "Uproot Clean",
		contactName: "Mehul Patel",
		contactRole: "Founder",
	},
} as const satisfies Record<string, ReplyProspectMeta>;

function buildReplyFixture(
	id: string,
	category: InboundReplyEvalFixture["category"],
	mode: InboundReplyEvalFixture["mode"],
	prospect: ReplyProspectMeta,
	emailLocal: string,
	inboundBodyTemplate: string
): InboundReplyEvalFixture {
	return {
		category,
		companyDomain: prospect.companyDomain,
		companyName: prospect.companyName,
		contactEmail: `${emailLocal}@${prospect.companyDomain}`,
		contactName: prospect.contactName,
		contactRole: prospect.contactRole,
		id,
		inboundBodyTemplate,
		mode,
	};
}

/**
 * 30 inbound reply scenarios spanning pricing refusal, opt-out, bot disclosure,
 * human escalation, and live calendar slot offering/booking using real Exa brands.
 */
export const INBOUND_REPLY_EVAL_FIXTURES: InboundReplyEvalFixture[] = [
	// 6 Pricing refusal cases
	buildReplyFixture(
		"reply-pricing-01",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.uproot,
		"mehul.p1",
		"How much do you charge?"
	),
	buildReplyFixture(
		"reply-pricing-02",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.south40,
		"josh.p2",
		"What's a ballpark monthly fee for an $8M Shopify brand?"
	),
	buildReplyFixture(
		"reply-pricing-03",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.curlfriend,
		"chloe.p3",
		"Send me your pricing tiers"
	),
	buildReplyFixture(
		"reply-pricing-04",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.flyby,
		"jing.p4",
		"What do your monthly retainers typically run for a Shopify & wholesale brand?"
	),
	buildReplyFixture(
		"reply-pricing-05",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.caldera,
		"dylan.p5",
		"Can you share a rough dollar estimate before we hop on a call?"
	),
	buildReplyFixture(
		"reply-pricing-06",
		"pricing_refusal",
		"standard",
		REPLY_PROSPECTS.farm,
		"jackson.p6",
		"How do you structure your fees — is there a base monthly cost per sales channel?"
	),

	// 6 Opt-out cases
	buildReplyFixture(
		"reply-optout-01",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.uproot,
		"optout1",
		"STOP"
	),
	buildReplyFixture(
		"reply-optout-02",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.south40,
		"optout2",
		"Unsubscribe"
	),
	buildReplyFixture(
		"reply-optout-03",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.curlfriend,
		"optout3",
		"Not interested"
	),
	buildReplyFixture(
		"reply-optout-04",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.flyby,
		"optout4",
		"Please take me off your list"
	),
	buildReplyFixture(
		"reply-optout-05",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.rho,
		"optout5",
		"Stop emailing me"
	),
	buildReplyFixture(
		"reply-optout-06",
		"opt_out",
		"standard",
		REPLY_PROSPECTS.goodjanes,
		"optout6",
		"We aren't looking for outside accounting vendors right now, please remove me from this sequence."
	),

	// 5 Bot disclosure cases
	buildReplyFixture(
		"reply-bot-01",
		"bot_disclosure",
		"standard",
		REPLY_PROSPECTS.uproot,
		"bot1",
		"Are you a bot?"
	),
	buildReplyFixture(
		"reply-bot-02",
		"bot_disclosure",
		"standard",
		REPLY_PROSPECTS.south40,
		"bot2",
		"Am I talking to an AI?"
	),
	buildReplyFixture(
		"reply-bot-03",
		"bot_disclosure",
		"standard",
		REPLY_PROSPECTS.curlfriend,
		"bot3",
		"Is this automated or a real person?"
	),
	buildReplyFixture(
		"reply-bot-04",
		"bot_disclosure",
		"standard",
		REPLY_PROSPECTS.flyby,
		"bot4",
		"Quick question before we chat — is an AI writing these emails or are you a human on the Ledgerwise team?"
	),
	buildReplyFixture(
		"reply-bot-05",
		"bot_disclosure",
		"standard",
		REPLY_PROSPECTS.caldera,
		"bot5",
		"Be honest, are you an AI assistant reaching out on behalf of Ledgerwise?"
	),

	// 5 Human escalation cases
	buildReplyFixture(
		"reply-escalate-01",
		"human_escalation",
		"standard",
		REPLY_PROSPECTS.uproot,
		"esc1",
		"Can you handle multi-entity German VAT audits and custom NetSuite SuiteScript?"
	),
	buildReplyFixture(
		"reply-escalate-02",
		"human_escalation",
		"standard",
		REPLY_PROSPECTS.south40,
		"esc2",
		"Can you represent us in an IRS dispute?"
	),
	buildReplyFixture(
		"reply-escalate-03",
		"human_escalation",
		"standard",
		REPLY_PROSPECTS.bask,
		"esc3",
		"Will your CPA sign our audited GAAP financial statements for our bank covenant and complete a SOC 2 Type II vendor security questionnaire?"
	),
	buildReplyFixture(
		"reply-escalate-04",
		"human_escalation",
		"standard",
		REPLY_PROSPECTS.flyby,
		"esc4",
		"We need transfer pricing tax opinions between our Delaware C-Corp and a Cayman IP holding subsidiary — do you cover that?"
	),
	buildReplyFixture(
		"reply-escalate-05",
		"human_escalation",
		"standard",
		REPLY_PROSPECTS.rho,
		"esc5",
		"Looping in our CFO — can a human partner on your team review our custom ERP migration NDA first?"
	),

	// 8 Calendar offer / booking cases
	buildReplyFixture(
		"reply-calendar-01",
		"calendar_booking",
		"offer_slots",
		REPLY_PROSPECTS.uproot,
		"cal1",
		"Yes, I'd love to chat this week. What times do you have open?"
	),
	buildReplyFixture(
		"reply-calendar-02",
		"calendar_booking",
		"offer_slots",
		REPLY_PROSPECTS.south40,
		"cal2",
		"We're reconciling Shopify and Whole Foods retail right now — when can we hop on a 30-minute call?"
	),
	buildReplyFixture(
		"reply-calendar-03",
		"calendar_booking",
		"offer_slots",
		REPLY_PROSPECTS.curlfriend,
		"cal3",
		"Do you have any availability in Pacific Time (America/Los_Angeles) this week?"
	),
	buildReplyFixture(
		"reply-calendar-04",
		"calendar_booking",
		"offer_slots",
		REPLY_PROSPECTS.flyby,
		"cal4",
		"None of the early morning times work for me, could you share a few other open calendar slots this week?"
	),
	buildReplyFixture(
		"reply-calendar-05",
		"calendar_booking",
		"book_selected_slot",
		REPLY_PROSPECTS.caldera,
		"cal5",
		"Let's lock in the first slot you offered ({SLOT_0_LABEL}). Please send the calendar invite!"
	),
	buildReplyFixture(
		"reply-calendar-06",
		"calendar_booking",
		"book_selected_slot",
		REPLY_PROSPECTS.farm,
		"cal6",
		"The second option ({SLOT_1_LABEL}) works great for me. Please book that one."
	),
	buildReplyFixture(
		"reply-calendar-07",
		"calendar_booking",
		"book_selected_slot",
		REPLY_PROSPECTS.rho,
		"cal7",
		"Let's do the third slot ({SLOT_2_LABEL}) — please confirm the meeting."
	),
	buildReplyFixture(
		"reply-calendar-08",
		"calendar_booking",
		"book_selected_slot",
		REPLY_PROSPECTS.goodjanes,
		"cal8",
		"Great, let's book {SLOT_0_LABEL} for our 30-minute Ledgerwise walkthrough."
	),
];

export type SdrAutopilotMode = "off" | "replies_auto" | "full";
export type SdrAiDisclosureMode = "when_asked" | "always";
export type CompanyStatus =
	| "discovered"
	| "researching"
	| "qualified"
	| "disqualified"
	| "drafted"
	| "contacted"
	| "replied"
	| "meeting_booked"
	| "suppressed";
export type CompanyTier = "A" | "B" | "C" | "DQ";
export type ScoreConfidence = "high" | "medium" | "low";
export type EvidenceKind =
	| "website"
	| "job_posting"
	| "news"
	| "funding"
	| "marketplace"
	| "press"
	| "fingerprint";
export type QualificationCriterionKey =
	| "us_based"
	| "ecommerce_brand"
	| "revenue_1m_10m"
	| "employees_5_50"
	| "decision_maker_found"
	| "signal_hiring_finance_ops"
	| "signal_recent_funding"
	| "signal_channel_expansion"
	| "enterprise_disqualifier";
export type CriterionVerdict = "met" | "not_met" | "unknown";
export type ThreadStatus =
	| "draft"
	| "awaiting_review"
	| "active"
	| "needs_human"
	| "human"
	| "booked"
	| "closed"
	| "opted_out";
export type ThreadAiMode = "auto" | "paused";
export type MessageDirection = "outbound" | "inbound";
export type MessageAuthor = "ai" | "human" | "prospect" | "system";
export type MessageStatus =
	| "draft"
	| "pending_review"
	| "approved"
	| "rejected"
	| "queued"
	| "sent"
	| "failed"
	| "received";

export interface SdrPlaybookFaqItem {
	answer: string;
	question: string;
}

export interface SdrPlaybookObjectionItem {
	objection: string;
	responseGuidance: string;
}

export interface SdrPlaybookConfig {
	callToAction: string;
	companyDescription: string;
	differentiators: string[];
	faq: SdrPlaybookFaqItem[];
	forbiddenTopics: string[];
	idealCustomerSummary: string;
	objectionHandling: SdrPlaybookObjectionItem[];
	pricingPolicy: string;
	services: string[];
}

export interface SdrIcpConfig {
	employeeMax: number;
	employeeMin: number;
	geography: string;
	revenueMaxUsd: number;
	revenueMinUsd: number;
	targetChannels: string[];
	targetPersonas: string[];
	timingSignals: string[];
}

export interface OfferedSlot {
	endIso: string;
	formattedLabel: string;
	startIso: string;
	timezone: string;
}

export interface MessageCitation {
	claim?: string;
	evidenceId: string;
	quote?: string;
	span: string;
	url?: string;
}

export interface FactCheckClaimResult {
	claim: string;
	evidenceId?: string | null;
	rationale: string;
	supported: boolean;
}

export interface FactCheckReport {
	claims: FactCheckClaimResult[];
	passed: boolean;
	priceMentionDetected: boolean;
	wordCount: number;
}

export interface ReplyClassificationReport {
	asksIfBot: boolean;
	confidence: number;
	detectedTimezone?: string | null;
	intent:
		| "opt_out"
		| "question"
		| "objection"
		| "pricing_inquiry"
		| "bot_inquiry"
		| "meeting_interest"
		| "slot_selection"
		| "referral"
		| "out_of_office"
		| "human_request"
		| "hostile"
		| "unclear";
	isOptOut: boolean;
	mentionsPricing: boolean;
	needsInfoFromHuman: boolean;
	rationale: string;
	selectedSlotIso?: string | null;
	wantsMeeting: boolean;
}

export interface SdrCompanySummary {
	channels: string[];
	domain: string;
	employeeBand: string;
	hqLocation: string | null;
	id: string;
	lastResearchedAt: string | null;
	name: string;
	primaryContact: {
		email: string | null;
		fullName: string;
		id: string;
		persona: string;
		title: string;
	} | null;
	revenueBand: string;
	score: number;
	scoreConfidence: ScoreConfidence;
	signals: string[];
	status: CompanyStatus;
	summary: string | null;
	thread: {
		id: string;
		status: ThreadStatus;
	} | null;
	tier: CompanyTier;
	website: string;
}

export interface SdrEvidenceItem {
	claim: string;
	companyId: string;
	id: string;
	kind: EvidenceKind;
	publishedAt: string | null;
	quote: string;
	title: string | null;
	url: string;
	verificationMethod: "exact" | "fuzzy" | "deterministic";
	verified: boolean;
}

export interface SdrCriterionItem {
	companyId: string;
	criterion: QualificationCriterionKey;
	evidenceIds: string[];
	id: string;
	maxPoints: number;
	points: number;
	rationale: string;
	verdict: CriterionVerdict;
}

export interface SdrMessageItem {
	aiOriginalBody?: string | null;
	author: MessageAuthor;
	bodyText: string;
	citations: MessageCitation[];
	classification?: ReplyClassificationReport | null;
	createdAt: string;
	decisionSummary?: string | null;
	direction: MessageDirection;
	factCheck?: FactCheckReport | null;
	id: string;
	rejectReason?: string | null;
	sentAt?: string | null;
	status: MessageStatus;
	subject: string;
	threadId: string;
}

export interface SdrThreadItem {
	aiMode: ThreadAiMode;
	aiReplyCount: number;
	companyId: string;
	contactId: string | null;
	handoffReason: string | null;
	id: string;
	lastMessageAt: string;
	offeredSlots: OfferedSlot[];
	pendingJobId: string | null;
	prospectTimezone: string;
	replyToken: string;
	status: ThreadStatus;
}

export interface SdrMeetingItem {
	attendeeEmail: string;
	calBookingUid: string;
	companyId: string;
	contactId: string | null;
	endAt: string;
	id: string;
	meetingUrl: string | null;
	notes: string | null;
	startAt: string;
	status: "scheduled" | "cancelled" | "rescheduled" | "completed";
	threadId: string | null;
	timezone: string;
	title: string;
}

export interface SdrSettingsState {
	aiDisclosure: SdrAiDisclosureMode;
	autopilot: SdrAutopilotMode;
	dailySendCap: number;
	icp: SdrIcpConfig;
	playbook: SdrPlaybookConfig;
	senderName: string;
	senderTitle: string;
	signature: string;
}

export const INITIAL_FALLBACK_SETTINGS: SdrSettingsState = {
	aiDisclosure: "when_asked",
	autopilot: "replies_auto",
	dailySendCap: 50,
	senderName: "Dana Mercer",
	senderTitle: "Head of Partnerships, Ledgerwise",
	signature: "Best,\nDana Mercer\nHead of Partnerships, Ledgerwise",
	icp: {
		geography: "United States",
		revenueMinUsd: 1_000_000,
		revenueMaxUsd: 10_000_000,
		employeeMin: 5,
		employeeMax: 50,
		targetChannels: [
			"Shopify",
			"Amazon Seller Central",
			"DTC Storefront",
			"Wholesale / Retail",
		],
		targetPersonas: [
			"Founder / Co-Founder",
			"Chief Operating Officer (COO)",
			"VP / Head of Finance / Controller",
		],
		timingSignals: [
			"Hiring for finance, accounting, bookkeeping, or operations roles",
			"Recently raised seed, Series A, or growth capital",
			"Expanding into new channels (Amazon, wholesale, retail stores, new countries)",
		],
	},
	playbook: {
		companyDescription:
			"Ledgerwise is a US outsourced bookkeeping firm purpose-built for e-commerce brands selling on Shopify, Amazon, and omnichannel retail.",
		idealCustomerSummary:
			"US e-commerce brands with $1M–$10M in annual revenue and 5–50 employees, reaching out to the Founder, COO, or Finance lead.",
		services: [
			"Monthly accrual bookkeeping closed by the 10th business day",
			"Daily payout, fee, refund, and reserve reconciliation across Shopify, Amazon Seller Central, Stripe, PayPal, and Faire",
			"SKU-level landed COGS, 3PL inventory tracking (ShipBob, Red Stag), and channel margin reporting",
			"Multi-state sales tax nexus monitoring and investor-ready reporting packages",
		],
		differentiators: [
			"Dedicated US ecommerce accounting pod instead of generalist bookkeepers or black-box software",
			"Gross-to-net settlement clearing so marketplace fees and FBA reserves never distort revenue",
			"Works directly alongside your existing tax CPA at year-end",
		],
		pricingPolicy:
			"Never quote a price, monthly fee, or rate range in email. Pricing is scoped to monthly order volume, sales channels, and inventory complexity on a 15-minute intro call.",
		faq: [
			{
				question: "How do you reconcile Shopify and Amazon Seller Central?",
				answer:
					"We reconcile every settlement batch from Shopify Payments and Amazon Seller Central against gross orders, FBA fees, ad spend deductions, refunds, and reserve holds so QuickBooks matches bank deposits to the cent.",
			},
			{
				question: "How long does onboarding take?",
				answer:
					"About two weeks. We connect read-only to your storefronts, processors, and 3PL, clean up historical clearing and COGS accounts, and deliver your first channel-margin close by the 10th business day.",
			},
			{
				question: "Do you replace our tax CPA?",
				answer:
					"No—we run your monthly accrual close, COGS, and channel margin reporting, and deliver a clean, reconciled trial balance to your tax CPA at year-end.",
			},
		],
		objectionHandling: [
			{
				objection: "We already have a local CPA or bookkeeper",
				responseGuidance:
					"Acknowledge that a good tax CPA is essential, and explain that generalist bookkeepers often book net bank deposits as revenue instead of separating marketplace fees, FBA reserves, and landed COGS by SKU.",
			},
			{
				objection: "We use Bench / Pilot",
				responseGuidance:
					"Note that generic bookkeeping tools struggle with multi-channel 3PL inventory, wholesale net-60 terms, and Amazon settlement reserve timing.",
			},
		],
		forbiddenTopics: [
			"Never quote dollar prices, monthly retainers, or fee ranges",
			"Never claim anything about a company not backed by a verified source quote",
			"Never contact anyone who says stop, unsubscribe, or not interested",
		],
		callToAction:
			"Worth a quick 15-minute intro call next week to walk through how we handle multi-channel ecommerce closes?",
	},
};

export const INITIAL_FALLBACK_EVIDENCE: SdrEvidenceItem[] = [
	{
		id: "33333333-3333-4333-8333-333333333301",
		companyId: "22222222-2222-4222-8222-222222222201",
		kind: "job_posting",
		url: "https://boards.greenhouse.io/suncrestbotanics/jobs/4192831",
		title: "Operations & Finance Manager — Suncrest Botanics Careers",
		quote:
			"We are looking for an Operations & Finance Manager in Austin, TX to manage our monthly accrual close, ShipBob 3PL inventory counts, and daily Shopify + Amazon Seller Central payout reconciliation.",
		claim:
			"Hiring an Operations & Finance Manager in Austin, TX to own monthly close, 3PL inventory, and Shopify/Amazon payouts.",
		publishedAt: "2026-10-28T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
	{
		id: "33333333-3333-4333-8333-333333333302",
		companyId: "22222222-2222-4222-8222-222222222201",
		kind: "funding",
		url: "https://www.beautyindependent.com/suncrest-botanics-seed-funding-2026",
		title: "Suncrest Botanics Raises $3.2M Seed to Expand Clean Skincare",
		quote:
			"Austin-based skincare brand Suncrest Botanics has closed a $3.2M seed round led by Sonoma Consumer Partners to expand its 22-person team and accelerate Amazon Marketplace growth.",
		claim:
			"Raised $3.2M seed round in August 2026 with a 22-person team to scale Amazon Marketplace distribution.",
		publishedAt: "2026-08-14T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
	{
		id: "33333333-3333-4333-8333-333333333303",
		companyId: "22222222-2222-4222-8222-222222222201",
		kind: "fingerprint",
		url: "https://suncrestbotanics.com/pages/about",
		title: "About Us — Suncrest Botanics",
		quote:
			"Founded in Austin by Clara Vance, Suncrest Botanics ships clean botanical formulations direct-to-consumer via Shopify and Amazon.",
		claim: "Shopify storefront founded in Austin, TX by Clara Vance (CEO).",
		publishedAt: "2026-11-13T00:00:00Z",
		verified: true,
		verificationMethod: "deterministic",
	},
	{
		id: "33333333-3333-4333-8333-333333333304",
		companyId: "22222222-2222-4222-8222-222222222202",
		kind: "news",
		url: "https://www.modernretail.co/harbor-and-loom-wholesale-expansion-2026",
		title: "Harbor & Loom Expands Into Wholesale and Nordstrom",
		quote:
			"Brooklyn-based Harbor & Loom announced its expansion beyond DTC Shopify into Faire wholesale and 35 Nordstrom home departments nationwide.",
		claim:
			"Expanded beyond Shopify DTC into Faire wholesale and 35 Nordstrom stores in September 2026.",
		publishedAt: "2026-09-19T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
	{
		id: "33333333-3333-4333-8333-333333333305",
		companyId: "22222222-2222-4222-8222-222222222202",
		kind: "job_posting",
		url: "https://jobs.ashbyhq.com/harborandloom/9c81a24b",
		title: "Ecommerce Bookkeeper — Harbor & Loom",
		quote:
			"Reporting to Co-Founder & COO Maya Lin, the Ecommerce Bookkeeper will reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS.",
		claim:
			"Hiring an Ecommerce Bookkeeper reporting to Co-Founder & COO Maya Lin for Shopify + wholesale reconciliation.",
		publishedAt: "2026-10-15T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
	{
		id: "33333333-3333-4333-8333-333333333307",
		companyId: "22222222-2222-4222-8222-222222222203",
		kind: "funding",
		url: "https://www.outsidebusinessjournal.com/brands/trailhead-kettle-seed-round-2026",
		title: "Trailhead Kettle Co. Brews Up $2.8M Seed Round as Retail Grows",
		quote:
			"Denver's Trailhead Kettle Co., led by founder Lucas Vance, raised $2.8M in seed funding after crossing $5M in annual run-rate revenue across Shopify, Amazon FBA, and 140 REI stores.",
		claim:
			"Raised $2.8M seed round at $5M annual run-rate revenue across Shopify, Amazon FBA, and 140 REI stores.",
		publishedAt: "2026-07-22T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
	{
		id: "33333333-3333-4333-8333-333333333309",
		companyId: "22222222-2222-4222-8222-222222222204",
		kind: "job_posting",
		url: "https://jobs.lever.co/kovaathletic/88f102c4",
		title: "Inventory & Accounting Coordinator — Kova Athletic",
		quote:
			"Kova Athletic (Los Angeles, CA) is hiring an Inventory & Accounting Coordinator reporting to VP of Operations Elena Rostova to oversee Shopify payout reconciliation and 3PL inventory.",
		claim:
			"Hiring an Inventory & Accounting Coordinator in Los Angeles reporting to VP of Operations Elena Rostova.",
		publishedAt: "2026-11-01T00:00:00Z",
		verified: true,
		verificationMethod: "exact",
	},
];

export const INITIAL_FALLBACK_CRITERIA: SdrCriterionItem[] = [
	{
		id: "crit-1",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "us_based",
		verdict: "met",
		points: 0,
		maxPoints: 0,
		rationale:
			"Headquartered in Austin, TX (verified on Greenhouse & About page).",
		evidenceIds: ["33333333-3333-4333-8333-333333333301"],
	},
	{
		id: "crit-2",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "ecommerce_brand",
		verdict: "met",
		points: 15,
		maxPoints: 15,
		rationale:
			"Sells direct-to-consumer via Shopify Plus and Amazon Marketplace.",
		evidenceIds: ["33333333-3333-4333-8333-333333333303"],
	},
	{
		id: "crit-3",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "revenue_1m_10m",
		verdict: "unknown",
		points: 10,
		maxPoints: 15,
		rationale:
			"Est. fit (unreported): Private US DTC brand with $3.2M seed round and 22 employees (awarded 10/15 per private-brand rubric).",
		evidenceIds: ["33333333-3333-4333-8333-333333333302"],
	},
	{
		id: "crit-4",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "employees_5_50",
		verdict: "met",
		points: 15,
		maxPoints: 15,
		rationale:
			"22 employees reported in August 2026 seed funding announcement.",
		evidenceIds: ["33333333-3333-4333-8333-333333333302"],
	},
	{
		id: "crit-5",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "decision_maker_found",
		verdict: "met",
		points: 5,
		maxPoints: 5,
		rationale: "Identified Clara Vance, Founder & CEO.",
		evidenceIds: ["33333333-3333-4333-8333-333333333303"],
	},
	{
		id: "crit-6",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "signal_hiring_finance_ops",
		verdict: "met",
		points: 25,
		maxPoints: 25,
		rationale:
			"Hiring Operations & Finance Manager for monthly close and Shopify/Amazon reconciliation.",
		evidenceIds: ["33333333-3333-4333-8333-333333333301"],
	},
	{
		id: "crit-7",
		companyId: "22222222-2222-4222-8222-222222222201",
		criterion: "signal_recent_funding",
		verdict: "met",
		points: 15,
		maxPoints: 20,
		rationale: "Closed $3.2M seed round in August 2026.",
		evidenceIds: ["33333333-3333-4333-8333-333333333302"],
	},
	{
		id: "crit-8",
		companyId: "22222222-2222-4222-8222-222222222202",
		criterion: "ecommerce_brand",
		verdict: "met",
		points: 15,
		maxPoints: 15,
		rationale:
			"Shopify storefront expanding into Faire and 35 Nordstrom doors.",
		evidenceIds: ["33333333-3333-4333-8333-333333333304"],
	},
	{
		id: "crit-9",
		companyId: "22222222-2222-4222-8222-222222222202",
		criterion: "revenue_1m_10m",
		verdict: "unknown",
		points: 10,
		maxPoints: 15,
		rationale:
			"Est. fit (unreported): Passes US + e-commerce gates with no enterprise disqualifier (10/15).",
		evidenceIds: ["33333333-3333-4333-8333-333333333304"],
	},
	{
		id: "crit-10",
		companyId: "22222222-2222-4222-8222-222222222202",
		criterion: "employees_5_50",
		verdict: "unknown",
		points: 10,
		maxPoints: 15,
		rationale:
			"Est. fit (unreported): Private Brooklyn team hiring first dedicated bookkeeper (10/15).",
		evidenceIds: ["33333333-3333-4333-8333-333333333305"],
	},
	{
		id: "crit-11",
		companyId: "22222222-2222-4222-8222-222222222202",
		criterion: "signal_hiring_finance_ops",
		verdict: "met",
		points: 20,
		maxPoints: 25,
		rationale: "Hiring Ecommerce Bookkeeper on Ashby.",
		evidenceIds: ["33333333-3333-4333-8333-333333333305"],
	},
	{
		id: "crit-12",
		companyId: "22222222-2222-4222-8222-222222222202",
		criterion: "signal_channel_expansion",
		verdict: "met",
		points: 15,
		maxPoints: 15,
		rationale: "Launched Faire wholesale and 35 Nordstrom stores.",
		evidenceIds: ["33333333-3333-4333-8333-333333333304"],
	},
];

export const INITIAL_FALLBACK_COMPANIES: SdrCompanySummary[] = [
	{
		id: "22222222-2222-4222-8222-222222222201",
		name: "Suncrest Botanics",
		domain: "suncrestbotanics.com",
		website: "https://suncrestbotanics.com",
		hqLocation: "Austin, TX",
		channels: ["Shopify", "Amazon"],
		signals: ["Hiring Finance/Ops", "Recent Funding"],
		summary:
			"Austin-based clean skincare DTC brand selling on Shopify Plus and Amazon, recently closed a $3.2M seed round and is hiring an Operations & Finance Manager.",
		revenueBand: "unknown",
		employeeBand: "15-30 (reported)",
		status: "drafted",
		score: 85,
		tier: "A",
		scoreConfidence: "high",
		lastResearchedAt: "2026-11-13T17:15:00Z",
		primaryContact: {
			id: "44444444-4444-4444-8444-444444444401",
			fullName: "Clara Vance",
			title: "Founder & CEO",
			persona: "founder",
			email: "clara@suncrestbotanics.com",
		},
		thread: {
			id: "55555555-5555-4555-8555-555555555501",
			status: "awaiting_review",
		},
	},
	{
		id: "22222222-2222-4222-8222-222222222203",
		name: "Trailhead Kettle Co.",
		domain: "trailheadkettle.com",
		website: "https://trailheadkettle.com",
		hqLocation: "Denver, CO",
		channels: ["Shopify", "Amazon", "Retail"],
		signals: ["Recent Funding", "Channel Expansion"],
		summary:
			"Specialty outdoor coffee & camp cookware brand in Denver selling via Shopify, Amazon FBA, and 140+ REI doors following a $2.8M seed round.",
		revenueBand: "$4M-$7M (reported)",
		employeeBand: "20-35 (reported)",
		status: "meeting_booked",
		score: 80,
		tier: "A",
		scoreConfidence: "high",
		lastResearchedAt: "2026-11-13T17:20:00Z",
		primaryContact: {
			id: "44444444-4444-4444-8444-444444444403",
			fullName: "Lucas Vance",
			title: "Founder & CEO",
			persona: "founder",
			email: "lucas@trailheadkettle.com",
		},
		thread: {
			id: "55555555-5555-4555-8555-555555555503",
			status: "booked",
		},
	},
	{
		id: "22222222-2222-4222-8222-222222222202",
		name: "Harbor & Loom",
		domain: "harborandloom.com",
		website: "https://harborandloom.com",
		hqLocation: "Brooklyn, NY",
		channels: ["Shopify", "Wholesale"],
		signals: ["Channel Expansion", "Hiring Finance/Ops"],
		summary:
			"Brooklyn home textiles brand running on Shopify, expanding into Faire and Nordstrom wholesale doors while recruiting an Ecommerce Bookkeeper.",
		revenueBand: "unknown",
		employeeBand: "unknown",
		status: "replied",
		score: 75,
		tier: "A",
		scoreConfidence: "high",
		lastResearchedAt: "2026-11-13T17:18:00Z",
		primaryContact: {
			id: "44444444-4444-4444-8444-444444444402",
			fullName: "Maya Lin",
			title: "Co-Founder & COO",
			persona: "coo",
			email: "maya@harborandloom.com",
		},
		thread: {
			id: "55555555-5555-4555-8555-555555555502",
			status: "active",
		},
	},
	{
		id: "22222222-2222-4222-8222-222222222204",
		name: "Kova Athletic",
		domain: "kovaathletic.com",
		website: "https://kovaathletic.com",
		hqLocation: "Los Angeles, CA",
		channels: ["Shopify", "Wholesale"],
		signals: ["Hiring Finance/Ops"],
		summary:
			"Los Angeles performance recovery apparel brand on Shopify, currently hiring an Inventory & Accounting Coordinator to manage 3PL and retail expansion.",
		revenueBand: "unknown",
		employeeBand: "unknown",
		status: "replied",
		score: 65,
		tier: "B",
		scoreConfidence: "medium",
		lastResearchedAt: "2026-11-13T17:25:00Z",
		primaryContact: {
			id: "44444444-4444-4444-8444-444444444404",
			fullName: "Elena Rostova",
			title: "VP of Operations",
			persona: "coo",
			email: "elena@kovaathletic.com",
		},
		thread: {
			id: "55555555-5555-4555-8555-555555555504",
			status: "needs_human",
		},
	},
];

export const INITIAL_FALLBACK_THREADS: SdrThreadItem[] = [
	{
		id: "55555555-5555-4555-8555-555555555504",
		companyId: "22222222-2222-4222-8222-222222222204",
		contactId: "44444444-4444-4444-8444-444444444404",
		status: "needs_human",
		aiMode: "paused",
		pendingJobId: null,
		prospectTimezone: "America/Los_Angeles",
		handoffReason:
			"Prospect asked about custom SPS Commerce EDI 850/810 chargeback dispute portals for Dick's Sporting Goods, which is outside the Ledgerwise playbook.",
		replyToken: "tok_kova_04",
		offeredSlots: [],
		lastMessageAt: "2026-11-13T18:30:00Z",
		aiReplyCount: 0,
	},
	{
		id: "55555555-5555-4555-8555-555555555502",
		companyId: "22222222-2222-4222-8222-222222222202",
		contactId: "44444444-4444-4444-8444-444444444402",
		status: "active",
		aiMode: "auto",
		pendingJobId: null,
		prospectTimezone: "America/New_York",
		handoffReason: null,
		replyToken: "tok_harbor_02",
		offeredSlots: [
			{
				startIso: "2026-11-16T15:00:00.000Z",
				endIso: "2026-11-16T15:15:00.000Z",
				formattedLabel: "Mon, Nov 16 at 10:00 AM ET",
				timezone: "America/New_York",
			},
			{
				startIso: "2026-11-17T19:00:00.000Z",
				endIso: "2026-11-17T19:15:00.000Z",
				formattedLabel: "Tue, Nov 17 at 2:00 PM ET",
				timezone: "America/New_York",
			},
			{
				startIso: "2026-11-18T16:00:00.000Z",
				endIso: "2026-11-18T16:15:00.000Z",
				formattedLabel: "Wed, Nov 18 at 11:00 AM ET",
				timezone: "America/New_York",
			},
		],
		lastMessageAt: "2026-11-13T18:10:00Z",
		aiReplyCount: 1,
	},
	{
		id: "55555555-5555-4555-8555-555555555503",
		companyId: "22222222-2222-4222-8222-222222222203",
		contactId: "44444444-4444-4444-8444-444444444403",
		status: "booked",
		aiMode: "auto",
		pendingJobId: null,
		prospectTimezone: "America/Denver",
		handoffReason: null,
		replyToken: "tok_trailhead_03",
		offeredSlots: [
			{
				startIso: "2026-11-16T19:00:00.000Z",
				endIso: "2026-11-16T19:15:00.000Z",
				formattedLabel: "Mon, Nov 16 at 12:00 PM MT (2:00 PM ET)",
				timezone: "America/Denver",
			},
		],
		lastMessageAt: "2026-11-13T18:25:00Z",
		aiReplyCount: 2,
	},
	{
		id: "55555555-5555-4555-8555-555555555501",
		companyId: "22222222-2222-4222-8222-222222222201",
		contactId: "44444444-4444-4444-8444-444444444401",
		status: "awaiting_review",
		aiMode: "auto",
		pendingJobId: null,
		prospectTimezone: "America/Chicago",
		handoffReason: null,
		replyToken: "tok_suncrest_01",
		offeredSlots: [],
		lastMessageAt: "2026-11-13T17:35:00Z",
		aiReplyCount: 0,
	},
];

export const INITIAL_FALLBACK_MESSAGES: SdrMessageItem[] = [
	{
		id: "66666666-6666-4666-8666-666666666601",
		threadId: "55555555-5555-4555-8555-555555555501",
		direction: "outbound",
		author: "ai",
		status: "pending_review",
		subject: "Suncrest's Operations & Finance hire / Shopify + Amazon close",
		bodyText:
			"Hi Clara,\n\nSaw Suncrest Botanics recently closed your $3.2M seed round and that you're hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation.\n\nAt Ledgerwise, our ecommerce accounting pods run that exact Shopify, Amazon Seller Central, and 3PL landed-COGS close for growing DTC brands—delivered by the 10th business day before you even need a full-time finance hire.\n\nWorth a quick 15-minute chat next week to see if we could take the monthly close off your plate?\n\nBest,\nDana Mercer",
		aiOriginalBody:
			"Hi Clara,\n\nSaw Suncrest Botanics recently closed your $3.2M seed round and that you're hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation.\n\nAt Ledgerwise, our ecommerce accounting pods run that exact Shopify, Amazon Seller Central, and 3PL landed-COGS close for growing DTC brands—delivered by the 10th business day before you even need a full-time finance hire.\n\nWorth a quick 15-minute chat next week to see if we could take the monthly close off your plate?\n\nBest,\nDana Mercer",
		citations: [
			{
				evidenceId: "33333333-3333-4333-8333-333333333302",
				span: "$3.2M seed round",
				claim: "Closed $3.2M seed round in August 2026",
				quote:
					"Austin-based skincare brand Suncrest Botanics has closed a $3.2M seed round led by Sonoma Consumer Partners",
				url: "https://www.beautyindependent.com/suncrest-botanics-seed-funding-2026",
			},
			{
				evidenceId: "33333333-3333-4333-8333-333333333301",
				span: "hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation",
				claim:
					"Hiring an Operations & Finance Manager in Austin for monthly close, ShipBob 3PL, and Shopify + Amazon reconciliation",
				quote:
					"We are looking for an Operations & Finance Manager in Austin, TX to manage our monthly accrual close, ShipBob 3PL inventory counts, and daily Shopify + Amazon Seller Central payout reconciliation.",
				url: "https://boards.greenhouse.io/suncrestbotanics/jobs/4192831",
			},
		],
		factCheck: {
			passed: true,
			wordCount: 88,
			priceMentionDetected: false,
			claims: [
				{
					claim: "Suncrest Botanics closed a $3.2M seed round",
					evidenceId: "33333333-3333-4333-8333-333333333302",
					supported: true,
					rationale: "Matched verbatim quote in Beauty Independent article.",
				},
				{
					claim:
						"Hiring an Operations & Finance Manager in Austin for monthly close, ShipBob 3PL, and Shopify + Amazon reconciliation",
					evidenceId: "33333333-3333-4333-8333-333333333301",
					supported: true,
					rationale: "Matched verbatim quote in Greenhouse job posting.",
				},
			],
		},
		decisionSummary:
			"Drafted 88-word conversational first email (<100 words, 0 links, 0 prices, 2/2 claims verified).",
		createdAt: "2026-11-13T17:35:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666602",
		threadId: "55555555-5555-4555-8555-555555555502",
		direction: "outbound",
		author: "ai",
		status: "sent",
		subject: "Harbor & Loom wholesale expansion + ecommerce bookkeeping",
		bodyText:
			"Hi Maya,\n\nCongrats on Harbor & Loom's expansion into Faire wholesale and 35 Nordstrom doors. I also noticed you're hiring an Ecommerce Bookkeeper in Brooklyn to reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS.\n\nLedgerwise runs monthly accrual bookkeeping specifically for DTC brands scaling into wholesale—reconciling Shopify, Faire, and inventory COGS by the 10th business day.\n\nOpen to a 15-minute call next week to compare notes before you hire?\n\nBest,\nDana Mercer",
		citations: [],
		decisionSummary: "Approved by Dana Mercer and sent via sandbox gate.",
		sentAt: "2026-11-13T17:45:00Z",
		createdAt: "2026-11-13T17:45:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666603",
		threadId: "55555555-5555-4555-8555-555555555502",
		direction: "inbound",
		author: "prospect",
		status: "received",
		subject: "Re: Harbor & Loom wholesale expansion + ecommerce bookkeeping",
		bodyText:
			"Hi Dana — timing is actually spot on. Since launching Nordstrom and Faire alongside Shopify, our landed COGS and net-60 wholesale reconciliations have been a headache. Roughly how much do you charge per month, and would you work with our existing tax CPA?",
		citations: [],
		classification: {
			intent: "pricing_inquiry",
			confidence: 0.94,
			isOptOut: false,
			asksIfBot: false,
			mentionsPricing: true,
			wantsMeeting: true,
			needsInfoFromHuman: false,
			detectedTimezone: "America/New_York",
			selectedSlotIso: null,
			rationale:
				"Prospect asks about monthly pricing and how Ledgerwise collaborates with their existing tax CPA.",
		},
		sentAt: "2026-11-13T18:08:00Z",
		createdAt: "2026-11-13T18:08:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666604",
		threadId: "55555555-5555-4555-8555-555555555502",
		direction: "outbound",
		author: "ai",
		status: "sent",
		subject: "Re: Harbor & Loom wholesale expansion + ecommerce bookkeeping",
		bodyText:
			"Glad the timing lined up, Maya!\n\nYes—we work right alongside your existing tax CPA. We handle the monthly accrual close, Shopify + Faire payout clearing, and SKU-level landed COGS, then hand your CPA a clean, reconciled trial balance at year-end.\n\nBecause we scope our work to your monthly order volume, active wholesale channels, and inventory setup, we always walk through pricing on a quick intro call rather than quoting flat tiers over email.\n\nWould any of these 15-minute slots work for you next week?\n• Mon, Nov 16 at 10:00 AM ET\n• Tue, Nov 17 at 2:00 PM ET\n• Wed, Nov 18 at 11:00 AM ET\n\nBest,\nDana Mercer",
		citations: [],
		decisionSummary:
			"Classified as pricing_inquiry + FAQ (High confidence) → answered CPA question from playbook, deflected pricing to call (0 $ quoted), and offered 3 live Cal.com slots.",
		sentAt: "2026-11-13T18:10:00Z",
		createdAt: "2026-11-13T18:10:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666605",
		threadId: "55555555-5555-4555-8555-555555555503",
		direction: "outbound",
		author: "ai",
		status: "sent",
		subject: "Trailhead Kettle's REI + Amazon FBA accounting",
		bodyText:
			"Hi Lucas,\n\nCongrats on Trailhead Kettle's $2.8M seed round and crossing 140 REI doors alongside Shopify and Amazon FBA.\n\nWhen outdoor brands scale across DTC, Amazon FBA reserves, and retail wholesale at once, landed COGS and settlement clearing usually get messy fast. Ledgerwise runs dedicated ecommerce accrual bookkeeping for 20–40 person consumer brands so your channel margins stay investor-ready every month.\n\nWorth a 15-minute intro call next week?\n\nBest,\nDana Mercer",
		citations: [],
		sentAt: "2026-11-13T16:00:00Z",
		createdAt: "2026-11-13T16:00:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666606",
		threadId: "55555555-5555-4555-8555-555555555503",
		direction: "inbound",
		author: "prospect",
		status: "received",
		subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
		bodyText:
			"Hey Dana, appreciate you reaching out. FBA fee settlements + REI wholesale inventory accounting is definitely our biggest pain point post-seed. Mon at 12:00 PM MT works great for me.",
		citations: [],
		classification: {
			intent: "slot_selection",
			confidence: 0.98,
			isOptOut: false,
			asksIfBot: false,
			mentionsPricing: false,
			wantsMeeting: true,
			needsInfoFromHuman: false,
			detectedTimezone: "America/Denver",
			selectedSlotIso: "2026-11-16T19:00:00.000Z",
			rationale:
				"Prospect confirmed Monday Nov 16 at 12:00 PM MT (2:00 PM ET).",
		},
		sentAt: "2026-11-13T18:24:00Z",
		createdAt: "2026-11-13T18:24:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666609",
		threadId: "55555555-5555-4555-8555-555555555503",
		direction: "outbound",
		author: "ai",
		status: "sent",
		subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
		bodyText:
			"You're all set, Lucas! I've booked our 15-minute intro call for Monday, Nov 16 at 12:00 PM MT (2:00 PM ET) and sent a calendar invite with the video link to lucas@trailheadkettle.com.\n\nLooking forward to speaking on Monday!\n\nBest,\nDana Mercer",
		citations: [],
		decisionSummary:
			"Matched slot 2026-11-16T19:00:00.000Z → verified slot free on Cal.com → created booking cal_bk_trailhead_kettle_20261116 and sent confirmation.",
		sentAt: "2026-11-13T18:25:00Z",
		createdAt: "2026-11-13T18:25:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666610",
		threadId: "55555555-5555-4555-8555-555555555504",
		direction: "outbound",
		author: "ai",
		status: "sent",
		subject: "Kova Athletic's Inventory & Accounting role",
		bodyText:
			"Hi Elena,\n\nSaw Kova Athletic is hiring an Inventory & Accounting Coordinator in Los Angeles to manage Shopify payout reconciliation and 3PL inventory.\n\nLedgerwise runs monthly accrual bookkeeping, 3PL landed-COGS tracking, and daily Shopify reconciliation for growing apparel brands so your ops team doesn't have to babysit the close.\n\nWorth a 15-minute call next week to see if we can help?\n\nBest,\nDana Mercer",
		citations: [],
		sentAt: "2026-11-13T16:30:00Z",
		createdAt: "2026-11-13T16:30:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666611",
		threadId: "55555555-5555-4555-8555-555555555504",
		direction: "inbound",
		author: "prospect",
		status: "received",
		subject: "Re: Kova Athletic's Inventory & Accounting role",
		bodyText:
			"Hi Dana, quick technical question before we jump on a call: do you guys handle SPS Commerce EDI 850/810 chargeback dispute portals for Dick's Sporting Goods inside NetSuite, or strictly financial bookkeeping?",
		citations: [],
		classification: {
			intent: "question",
			confidence: 0.68,
			isOptOut: false,
			asksIfBot: false,
			mentionsPricing: false,
			wantsMeeting: false,
			needsInfoFromHuman: true,
			detectedTimezone: "America/Los_Angeles",
			selectedSlotIso: null,
			rationale:
				"Prospect asks about SPS Commerce EDI 850/810 chargeback dispute portals, which is outside the Ledgerwise playbook. Handed off to human.",
		},
		sentAt: "2026-11-13T18:30:00Z",
		createdAt: "2026-11-13T18:30:00Z",
	},
	{
		id: "66666666-6666-4666-8666-666666666612",
		threadId: "55555555-5555-4555-8555-555555555504",
		direction: "outbound",
		author: "ai",
		status: "draft",
		subject: "Re: Kova Athletic's Inventory & Accounting role",
		bodyText:
			"Hi Elena,\n\nGreat question—we reconcile SPS Commerce EDI invoices and retail chargeback deductions on the accounting side inside NetSuite and QuickBooks so your gross-to-net wholesale margins are accurate, while your ops/3PL team submits the operational portal disputes.\n\nIf helpful, I'd love to walk through how we structure retail chargeback reserves on a quick 15-minute call next week. Would Tuesday or Wednesday afternoon PT work?\n\nBest,\nDana Mercer",
		citations: [],
		decisionSummary:
			"Escalated to human (needsInfoFromHuman = true, confidence 0.68 < 0.75): saved suggested reply draft for sales rep review and paused AI auto-reply.",
		createdAt: "2026-11-13T18:30:05Z",
	},
];

export const INITIAL_FALLBACK_MEETINGS: SdrMeetingItem[] = [
	{
		id: "77777777-7777-4777-8777-777777777701",
		threadId: "55555555-5555-4555-8555-555555555503",
		companyId: "22222222-2222-4222-8222-222222222203",
		contactId: "44444444-4444-4444-8444-444444444403",
		calBookingUid: "cal_bk_trailhead_kettle_20261116",
		title: "Ledgerwise × Trailhead Kettle Co. — Intro Call (Lucas Vance)",
		startAt: "2026-11-16T19:00:00.000Z",
		endAt: "2026-11-16T19:15:00.000Z",
		timezone: "America/Denver",
		attendeeEmail: "lucas@trailheadkettle.com",
		meetingUrl: "https://app.cal.com/video/cal_bk_trailhead_kettle_20261116",
		notes:
			"15-min Intro Call: Amazon FBA settlement clearing + 140 REI retail doors inventory & COGS accounting.",
		status: "scheduled",
	},
];

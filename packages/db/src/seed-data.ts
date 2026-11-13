import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./index";
import {
	account,
	agentRuns,
	companies,
	contacts,
	evidence,
	meetings,
	member,
	messages,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	notificationPreference,
	organization,
	organizationStorageLimits,
	qualificationCriteria,
	researchRuns,
	type SdrIcpConfig,
	type SdrPlaybookConfig,
	sdrSettings,
	threads,
	user,
} from "./schema";

export const LEDGERWISE_ORG_ID = "org_ledgerwise";
export const LEDGERWISE_ORG_SLUG = "ledgerwise";
export const LEDGERWISE_OWNER_USER_ID = "usr_ledgerwise_dana";
export const LEDGERWISE_REVIEWER_USER_ID = "usr_ledgerwise_reviewer";

export const DEFAULT_LEDGERWISE_PLAYBOOK: SdrPlaybookConfig = {
	companyDescription:
		"Ledgerwise is a specialized US outsourced bookkeeping and ecommerce accounting firm that runs monthly accrual closes for DTC and omnichannel consumer brands.",
	idealCustomerSummary:
		"US e-commerce brands selling on Shopify, Amazon Seller Central, or their own storefront with roughly $1M–$10M in annual revenue and 5–50 employees, contacted via the Founder, COO, or Finance lead.",
	services: [
		"Monthly accrual-basis bookkeeping closed by the 10th business day of every month",
		"Automated payout, fee, refund, and reserve reconciliation across Shopify, Amazon Seller Central, Stripe, PayPal, Affirm, and Faire",
		"SKU-level landed COGS, 3PL inventory valuation (ShipBob, Red Stag, Deliverr), and channel gross-margin reporting",
		"Multi-state sales tax nexus monitoring and audit-ready financial packages for investors and inventory lenders",
	],
	differentiators: [
		"Dedicated US ecommerce accounting pod rather than generalist bookkeepers or black-box software",
		"True gross-to-net payout clearing so marketplace fees, chargebacks, and deferred gift cards never distort revenue",
		"Seamless collaboration with your existing tax CPA at year-end with zero cleanup fees",
	],
	pricingPolicy:
		"Never quote a price, monthly fee, or dollar range over email. Explain that pricing depends on monthly order volume, active sales channels, and inventory/3PL complexity, and offer a 15-minute intro call to scope it accurately.",
	faq: [
		{
			question: "How do you handle both Shopify and Amazon Seller Central?",
			answer:
				"We reconcile every settlement batch from Shopify Payments and Amazon Seller Central against gross orders, FBA fees, ad spend deductions, refunds, and reserve holds so your QuickBooks or Xero ledger matches your bank deposits to the cent.",
		},
		{
			question: "How long does onboarding take?",
			answer:
				"Onboarding takes about two weeks. We connect read-only to your storefronts, payment processors, and 3PL, clean up historical clearing and inventory accounts, and deliver your first full accrual close by the 10th business day.",
		},
		{
			question: "Do you replace our tax CPA?",
			answer:
				"No—we handle the day-to-day ecommerce accrual bookkeeping, COGS, and channel margin reporting, and hand your tax CPA a clean, reconciled trial balance at year-end.",
		},
	],
	objectionHandling: [
		{
			objection: "We already have a local bookkeeper or CPA",
			responseGuidance:
				"Acknowledge that a good tax CPA is essential, and note that generalist bookkeepers often record net bank deposits as revenue instead of breaking out marketplace fees, reserves, and landed COGS by channel. Offer a quick comparison call.",
		},
		{
			objection: "We use Bench / Pilot / automated software",
			responseGuidance:
				"Highlight that generic bookkeeping platforms struggle with multi-channel inventory, 3PL syncs, and Amazon reserve timing when brands expand into wholesale or new marketplaces.",
		},
	],
	forbiddenTopics: [
		"Never quote dollar prices, monthly retainers, or fee ranges",
		"Never provide formal tax filing or legal advice",
		"Never invent customer case studies or claim facts about a prospect not backed by verified evidence",
	],
	callToAction:
		"Worth a quick 15-minute intro call next week to walk through how we handle multi-channel ecommerce closes?",
};

export const DEFAULT_LEDGERWISE_ICP: SdrIcpConfig = {
	geography: "United States",
	revenueMinUsd: 1_000_000,
	revenueMaxUsd: 10_000_000,
	employeeMin: 5,
	employeeMax: 50,
	targetChannels: ["Shopify", "Amazon", "DTC Storefront", "Wholesale / Retail"],
	targetPersonas: [
		"Founder / Co-Founder",
		"Chief Operating Officer (COO)",
		"VP / Head of Finance / Controller",
	],
	timingSignals: [
		"Hiring for finance, accounting, bookkeeping, or operations roles",
		"Recently raised seed, Series A, or growth capital",
		"Expanding into new channels (Amazon, wholesale, retail stores, or international markets)",
	],
};

function hashBetterAuthPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	return new Promise((resolve, reject) => {
		scryptCallback(
			password.normalize("NFKC"),
			salt,
			64,
			{
				N: 16_384,
				r: 16,
				p: 1,
				maxmem: 128 * 16_384 * 16 * 2,
			},
			(err, derivedKey) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(`${salt}:${derivedKey.toString("hex")}`);
			}
		);
	});
}

// Deterministic UUIDs for idempotent sample records
const IDS = {
	run1: "11111111-1111-4111-8111-111111111101",
	compSuncrest: "22222222-2222-4222-8222-222222222201",
	compHarbor: "22222222-2222-4222-8222-222222222202",
	compTrailhead: "22222222-2222-4222-8222-222222222203",
	compKova: "22222222-2222-4222-8222-222222222204",
	evSuncrest1: "33333333-3333-4333-8333-333333333301",
	evSuncrest2: "33333333-3333-4333-8333-333333333302",
	evSuncrest3: "33333333-3333-4333-8333-333333333303",
	evHarbor1: "33333333-3333-4333-8333-333333333304",
	evHarbor2: "33333333-3333-4333-8333-333333333305",
	evHarbor3: "33333333-3333-4333-8333-333333333306",
	evTrailhead1: "33333333-3333-4333-8333-333333333307",
	evTrailhead2: "33333333-3333-4333-8333-333333333308",
	evKova1: "33333333-3333-4333-8333-333333333309",
	evKova2: "33333333-3333-4333-8333-333333333310",
	contactSuncrest: "44444444-4444-4444-8444-444444444401",
	contactHarbor: "44444444-4444-4444-8444-444444444402",
	contactTrailhead: "44444444-4444-4444-8444-444444444403",
	contactKova: "44444444-4444-4444-8444-444444444404",
	threadSuncrest: "55555555-5555-4555-8555-555555555501",
	threadHarbor: "55555555-5555-4555-8555-555555555502",
	threadTrailhead: "55555555-5555-4555-8555-555555555503",
	threadKova: "55555555-5555-4555-8555-555555555504",
	msgSuncrestDraft: "66666666-6666-4666-8666-666666666601",
	msgHarborFirst: "66666666-6666-4666-8666-666666666602",
	msgHarborInbound: "66666666-6666-4666-8666-666666666603",
	msgHarborAiReply: "66666666-6666-4666-8666-666666666604",
	msgTrailheadFirst: "66666666-6666-4666-8666-666666666605",
	msgTrailheadInbound1: "66666666-6666-4666-8666-666666666606",
	msgTrailheadAiSlots: "66666666-6666-4666-8666-666666666607",
	msgTrailheadInbound2: "66666666-6666-4666-8666-666666666608",
	msgTrailheadConfirm: "66666666-6666-4666-8666-666666666609",
	msgKovaFirst: "66666666-6666-4666-8666-666666666610",
	msgKovaInbound: "66666666-6666-4666-8666-666666666611",
	msgKovaSuggested: "66666666-6666-4666-8666-666666666612",
	meetingTrailhead: "77777777-7777-4777-8777-777777777701",
} as const;

export async function seedLedgerwiseWorkspace(
	database: Database,
	options: { resetExistingSdrData?: boolean } = {}
): Promise<{
	organizationId: string;
	ownerEmail: string;
	reviewerEmail: string;
}> {
	const demoPassword = process.env.DEMO_USER_PASSWORD || "Ledgerwise2026!";
	const passwordHash = await hashBetterAuthPassword(demoPassword);

	const demoOrgId = "org_demo_acme";
	const demoUserId = "usr_demo_admin";
	const demoMemberId = "mem_demo_admin";

	await database.transaction(async (tx) => {
		// 1. Preserve legacy Acme starter user/org for existing unit/integration tests
		await tx
			.insert(user)
			.values({
				email: "admin@acme.example",
				emailVerified: true,
				firstName: "Acme",
				id: demoUserId,
				lastName: "Admin",
				locale: "en",
				name: "Acme Admin",
				role: "user",
			})
			.onConflictDoNothing();

		await tx
			.insert(organization)
			.values({
				id: demoOrgId,
				name: "Acme Corporation",
				slug: "acme-corp",
			})
			.onConflictDoNothing();

		await tx
			.insert(member)
			.values({
				id: demoMemberId,
				organizationId: demoOrgId,
				role: "owner",
				userId: demoUserId,
			})
			.onConflictDoNothing();

		await tx
			.update(user)
			.set({ defaultOrganizationId: demoOrgId })
			.where(and(eq(user.id, demoUserId), isNull(user.defaultOrganizationId)));

		await tx
			.insert(organizationStorageLimits)
			.values({
				currentUsage: 0,
				organizationId: demoOrgId,
				storageLimit: 1024 * 1024 * 1024,
			})
			.onConflictDoNothing();

		// 2. Seed Ledgerwise organization and sales team users
		await tx
			.insert(organization)
			.values({
				id: LEDGERWISE_ORG_ID,
				name: "Ledgerwise",
				slug: LEDGERWISE_ORG_SLUG,
			})
			.onConflictDoNothing();

		await tx
			.insert(organizationStorageLimits)
			.values({
				currentUsage: 0,
				organizationId: LEDGERWISE_ORG_ID,
				storageLimit: 1024 * 1024 * 1024,
			})
			.onConflictDoNothing();

		await tx
			.insert(user)
			.values([
				{
					defaultOrganizationId: LEDGERWISE_ORG_ID,
					email: "dana@ledgerwise.demo",
					emailVerified: true,
					firstName: "Dana",
					id: LEDGERWISE_OWNER_USER_ID,
					lastName: "Mercer",
					locale: "en",
					name: "Dana Mercer",
					role: "user",
				},
				{
					defaultOrganizationId: LEDGERWISE_ORG_ID,
					email: "reviewer@ledgerwise.demo",
					emailVerified: true,
					firstName: "Unscale",
					id: LEDGERWISE_REVIEWER_USER_ID,
					lastName: "Reviewer",
					locale: "en",
					name: "Unscale Reviewer",
					role: "user",
				},
			])
			.onConflictDoNothing();

		// Ensure credential accounts exist so both users can sign in with email + password
		await tx
			.insert(account)
			.values([
				{
					accountId: LEDGERWISE_OWNER_USER_ID,
					id: "acc_ledgerwise_dana",
					password: passwordHash,
					providerId: "credential",
					userId: LEDGERWISE_OWNER_USER_ID,
				},
				{
					accountId: LEDGERWISE_REVIEWER_USER_ID,
					id: "acc_ledgerwise_reviewer",
					password: passwordHash,
					providerId: "credential",
					userId: LEDGERWISE_REVIEWER_USER_ID,
				},
			])
			.onConflictDoNothing();

		await tx
			.insert(member)
			.values([
				{
					id: "mem_ledgerwise_dana",
					organizationId: LEDGERWISE_ORG_ID,
					role: "owner",
					userId: LEDGERWISE_OWNER_USER_ID,
				},
				{
					id: "mem_ledgerwise_reviewer",
					organizationId: LEDGERWISE_ORG_ID,
					role: "admin",
					userId: LEDGERWISE_REVIEWER_USER_ID,
				},
				{
					id: "mem_ledgerwise_acme_admin",
					organizationId: LEDGERWISE_ORG_ID,
					role: "admin",
					userId: demoUserId,
				},
			])
			.onConflictDoNothing();

		const allSeededUsers = [
			demoUserId,
			LEDGERWISE_OWNER_USER_ID,
			LEDGERWISE_REVIEWER_USER_ID,
		];
		const prefRows = allSeededUsers.flatMap((uid) =>
			NOTIFICATION_CATEGORIES.flatMap((category) =>
				NOTIFICATION_CHANNELS.map((channel) => ({
					category,
					channel,
					enabled: true,
					userId: uid,
				}))
			)
		);

		await tx
			.insert(notificationPreference)
			.values(prefRows)
			.onConflictDoNothing();

		if (options.resetExistingSdrData) {
			await tx
				.delete(companies)
				.where(eq(companies.organizationId, LEDGERWISE_ORG_ID));
			await tx
				.delete(researchRuns)
				.where(eq(researchRuns.organizationId, LEDGERWISE_ORG_ID));
		}

		// 3. Seed Ledgerwise SDR Playbook & Settings
		await tx
			.insert(sdrSettings)
			.values({
				aiDisclosure: "when_asked",
				autopilot: "replies_auto",
				dailySendCap: 50,
				icp: DEFAULT_LEDGERWISE_ICP,
				organizationId: LEDGERWISE_ORG_ID,
				playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
				senderName: "Dana Mercer",
				senderTitle: "Head of Partnerships, Ledgerwise",
				sendWindow: {
					daysOfWeek: [1, 2, 3, 4, 5],
					endHourEt: 18,
					startHourEt: 8,
				},
				signature: "Best,\nDana Mercer\nHead of Partnerships, Ledgerwise",
			})
			.onConflictDoUpdate({
				set: {
					icp: DEFAULT_LEDGERWISE_ICP,
					playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
				},
				target: sdrSettings.organizationId,
			});

		// 4. Seed initial completed Research Run
		await tx
			.insert(researchRuns)
			.values({
				completedAt: new Date("2026-11-13T17:30:00Z"),
				foundCount: 6,
				id: IDS.run1,
				organizationId: LEDGERWISE_ORG_ID,
				qualifiedCount: 4,
				querySet: [
					"US Shopify brand hiring Controller or Head of Finance",
					"DTC ecommerce brand raised seed round 2026",
					"Shopify brand expanding into Amazon and retail wholesale",
				],
				researchedCount: 4,
				startedBy: LEDGERWISE_OWNER_USER_ID,
				status: "completed",
			})
			.onConflictDoNothing();

		// 5. Seed Sample Companies (covering Pending Review, Active AI Reply, Needs Human, and Booked Meeting)
		await tx
			.insert(companies)
			.values([
				{
					channels: ["Shopify", "Amazon"],
					domain: "suncrestbotanics.com",
					employeeBand: "15-30 (reported)",
					hqLocation: "Austin, TX",
					id: IDS.compSuncrest,
					lastResearchedAt: new Date("2026-11-13T17:15:00Z"),
					name: "Suncrest Botanics",
					organizationId: LEDGERWISE_ORG_ID,
					revenueBand: "unknown",
					score: 85,
					scoreConfidence: "high",
					signals: ["Hiring Finance/Ops", "Recent Funding"],
					status: "drafted",
					summary:
						"Austin-based clean skincare DTC brand selling on Shopify Plus and Amazon, recently closed a $3.2M seed extension and is hiring an Operations & Finance Manager.",
					tier: "A",
					website: "https://suncrestbotanics.com",
				},
				{
					channels: ["Shopify", "Wholesale"],
					domain: "harborandloom.com",
					employeeBand: "unknown",
					hqLocation: "Brooklyn, NY",
					id: IDS.compHarbor,
					lastResearchedAt: new Date("2026-11-13T17:18:00Z"),
					name: "Harbor & Loom",
					organizationId: LEDGERWISE_ORG_ID,
					revenueBand: "unknown",
					score: 75,
					scoreConfidence: "high",
					signals: ["Channel Expansion", "Hiring Finance/Ops"],
					status: "replied",
					summary:
						"Brooklyn home textiles brand running on Shopify, expanding into Faire and Nordstrom wholesale doors while recruiting a Staff Accountant.",
					tier: "A",
					website: "https://harborandloom.com",
				},
				{
					channels: ["Shopify", "Amazon", "Retail"],
					domain: "trailheadkettle.com",
					employeeBand: "20-35 (reported)",
					hqLocation: "Denver, CO",
					id: IDS.compTrailhead,
					lastResearchedAt: new Date("2026-11-13T17:20:00Z"),
					name: "Trailhead Kettle Co.",
					organizationId: LEDGERWISE_ORG_ID,
					revenueBand: "$4M-$7M (reported)",
					score: 80,
					scoreConfidence: "high",
					signals: ["Recent Funding", "Channel Expansion"],
					status: "meeting_booked",
					summary:
						"Specialty outdoor coffee & camp cookware brand in Denver selling via Shopify, Amazon FBA, and 140+ REI doors following a $2.8M seed round.",
					tier: "A",
					website: "https://trailheadkettle.com",
				},
				{
					channels: ["Shopify", "Wholesale"],
					domain: "kovaathletic.com",
					employeeBand: "unknown",
					hqLocation: "Los Angeles, CA",
					id: IDS.compKova,
					lastResearchedAt: new Date("2026-11-13T17:25:00Z"),
					name: "Kova Athletic",
					organizationId: LEDGERWISE_ORG_ID,
					revenueBand: "unknown",
					score: 65,
					scoreConfidence: "medium",
					signals: ["Hiring Finance/Ops"],
					status: "replied",
					summary:
						"Los Angeles performance recovery apparel brand on Shopify, currently hiring an Inventory & Accounting Coordinator to manage 3PL and retail expansion.",
					tier: "B",
					website: "https://kovaathletic.com",
				},
			])
			.onConflictDoNothing();

		// 6. Seed Verified Evidence rows
		await tx
			.insert(evidence)
			.values([
				{
					claim:
						"Suncrest Botanics is hiring an Operations & Finance Manager in Austin, TX to own monthly close, 3PL inventory reconciliation, and Shopify/Amazon payouts.",
					companyId: IDS.compSuncrest,
					id: IDS.evSuncrest1,
					kind: "job_posting",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-10-28T00:00:00Z"),
					quote:
						"We are looking for an Operations & Finance Manager in Austin, TX to manage our monthly accrual close, ShipBob 3PL inventory counts, and daily Shopify + Amazon Seller Central payout reconciliation.",
					title: "Operations & Finance Manager — Suncrest Botanics Careers",
					url: "https://boards.greenhouse.io/suncrestbotanics/jobs/4192831",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Suncrest Botanics raised a $3.2M seed round in August 2026 to scale Amazon and omnichannel distribution with a team of 22 employees.",
					companyId: IDS.compSuncrest,
					id: IDS.evSuncrest2,
					kind: "funding",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-08-14T00:00:00Z"),
					quote:
						"Austin-based skincare brand Suncrest Botanics has closed a $3.2M seed round led by Sonoma Consumer Partners to expand its 22-person team and accelerate Amazon Marketplace growth.",
					title: "Suncrest Botanics Raises $3.2M Seed to Expand Clean Skincare",
					url: "https://www.beautyindependent.com/suncrest-botanics-seed-funding-2026",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Storefront runs on Shopify (verified via cdn.shopify.com and /products.json) and is co-founded by Clara Vance (Founder & CEO).",
					companyId: IDS.compSuncrest,
					id: IDS.evSuncrest3,
					kind: "fingerprint",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-11-13T00:00:00Z"),
					quote:
						"Founded in Austin by Clara Vance, Suncrest Botanics ships clean botanical formulations direct-to-consumer via Shopify and Amazon.",
					title: "About Us — Suncrest Botanics",
					url: "https://suncrestbotanics.com/pages/about",
					verificationMethod: "deterministic",
					verified: true,
				},
				{
					claim:
						"Harbor & Loom launched wholesale distribution on Faire and in 35 Nordstrom doors in September 2026.",
					companyId: IDS.compHarbor,
					id: IDS.evHarbor1,
					kind: "news",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-09-19T00:00:00Z"),
					quote:
						"Brooklyn-based Harbor & Loom announced its expansion beyond DTC Shopify into Faire wholesale and 35 Nordstrom home departments nationwide.",
					title: "Harbor & Loom Expands Into Wholesale and Nordstrom",
					url: "https://www.modernretail.co/harbor-and-loom-wholesale-expansion-2026",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Harbor & Loom is hiring a Part-Time / Fractional Ecommerce Bookkeeper to reconcile Shopify and wholesale invoices.",
					companyId: IDS.compHarbor,
					id: IDS.evHarbor2,
					kind: "job_posting",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-10-15T00:00:00Z"),
					quote:
						"Reporting to Co-Founder & COO Maya Lin, the Ecommerce Bookkeeper will reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS.",
					title: "Ecommerce Bookkeeper — Harbor & Loom",
					url: "https://jobs.ashbyhq.com/harborandloom/9c81a24b",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Harbor & Loom operates on Shopify from Brooklyn, NY with Co-Founder & COO Maya Lin leading operations and finance.",
					companyId: IDS.compHarbor,
					id: IDS.evHarbor3,
					kind: "website",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-11-13T00:00:00Z"),
					quote:
						"Designed in our Brooklyn studio by co-founders Maya Lin (COO) and Theo Park, Harbor & Loom brings small-batch organic linens to modern homes.",
					title: "Our Story — Harbor & Loom",
					url: "https://harborandloom.com/pages/our-story",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Trailhead Kettle Co. closed a $2.8M seed round and expanded into Amazon FBA and 140 REI retail stores.",
					companyId: IDS.compTrailhead,
					id: IDS.evTrailhead1,
					kind: "funding",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-07-22T00:00:00Z"),
					quote:
						"Denver's Trailhead Kettle Co., led by founder Lucas Vance, raised $2.8M in seed funding after crossing $5M in annual run-rate revenue across Shopify, Amazon FBA, and 140 REI stores.",
					title:
						"Trailhead Kettle Co. Brews Up $2.8M Seed Round as Retail Footprint Grows",
					url: "https://www.outsidebusinessjournal.com/brands/trailhead-kettle-seed-round-2026",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Trailhead Kettle Co. operates a 26-person team in Denver, CO selling via Shopify and Amazon.",
					companyId: IDS.compTrailhead,
					id: IDS.evTrailhead2,
					kind: "website",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-11-13T00:00:00Z"),
					quote:
						"Built by a team of 26 outdoor coffee obsessives in Denver, Colorado.",
					title: "About Trailhead Kettle Co.",
					url: "https://trailheadkettle.com/pages/about",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Kova Athletic is hiring an Inventory & Accounting Coordinator in Los Angeles to manage Shopify, 3PL, and retail chargebacks.",
					companyId: IDS.compKova,
					id: IDS.evKova1,
					kind: "job_posting",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-11-01T00:00:00Z"),
					quote:
						"Kova Athletic (Los Angeles, CA) is hiring an Inventory & Accounting Coordinator reporting to VP of Operations Elena Rostova to oversee Shopify payout reconciliation and 3PL inventory.",
					title: "Inventory & Accounting Coordinator — Kova Athletic",
					url: "https://jobs.lever.co/kovaathletic/88f102c4",
					verificationMethod: "exact",
					verified: true,
				},
				{
					claim:
						"Kova Athletic is a US DTC activewear brand headquartered in Los Angeles, CA running on Shopify.",
					companyId: IDS.compKova,
					id: IDS.evKova2,
					kind: "fingerprint",
					organizationId: LEDGERWISE_ORG_ID,
					publishedAt: new Date("2026-11-13T00:00:00Z"),
					quote:
						"Verified Shopify storefront (cdn.shopify.com) headquartered at 1240 E 8th St, Los Angeles, CA.",
					title: "Kova Athletic Storefront Verification",
					url: "https://kovaathletic.com",
					verificationMethod: "deterministic",
					verified: true,
				},
			])
			.onConflictDoNothing();

		// 7. Seed Qualification Criteria Breakdown (demonstrating 10/15 unknown size rule)
		await tx
			.insert(qualificationCriteria)
			.values([
				// Suncrest Botanics (85 pts: 15 ecomm + 10 rev unknown + 15 emp met + 5 contact + 25 hiring + 20 funding - capped at 45 timing -> 85 total)
				{
					companyId: IDS.compSuncrest,
					criterion: "us_based",
					evidenceIds: [IDS.evSuncrest1, IDS.evSuncrest3],
					maxPoints: 0,
					organizationId: LEDGERWISE_ORG_ID,
					points: 0,
					rationale:
						"Headquartered in Austin, TX (verified on careers & about page).",
					verdict: "met",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "ecommerce_brand",
					evidenceIds: [IDS.evSuncrest1, IDS.evSuncrest3],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale: "Sells DTC on Shopify Plus and Amazon Marketplace.",
					verdict: "met",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "revenue_1m_10m",
					evidenceIds: [IDS.evSuncrest2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale:
						"Est. fit (unreported): Private US DTC brand with $3.2M seed round and 22 staff strongly implies $2M–$8M GMV.",
					verdict: "unknown",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "employees_5_50",
					evidenceIds: [IDS.evSuncrest2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale:
						"22 employees reported in August 2026 seed funding announcement.",
					verdict: "met",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "decision_maker_found",
					evidenceIds: [IDS.evSuncrest3],
					maxPoints: 5,
					organizationId: LEDGERWISE_ORG_ID,
					points: 5,
					rationale: "Identified Clara Vance, Founder & CEO.",
					verdict: "met",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "signal_hiring_finance_ops",
					evidenceIds: [IDS.evSuncrest1],
					maxPoints: 25,
					organizationId: LEDGERWISE_ORG_ID,
					points: 25,
					rationale:
						"Actively hiring Operations & Finance Manager for monthly accrual close and Shopify/Amazon reconciliation.",
					verdict: "met",
				},
				{
					companyId: IDS.compSuncrest,
					criterion: "signal_recent_funding",
					evidenceIds: [IDS.evSuncrest2],
					maxPoints: 20,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale: "Closed $3.2M seed round in August 2026.",
					verdict: "met",
				},
				// Harbor & Loom (75 pts: 15 ecomm + 10 rev unknown + 10 emp unknown + 5 contact + 25 hiring + 15 expansion -> timing 35 -> 75 total)
				{
					companyId: IDS.compHarbor,
					criterion: "us_based",
					evidenceIds: [IDS.evHarbor3],
					maxPoints: 0,
					organizationId: LEDGERWISE_ORG_ID,
					points: 0,
					rationale: "Headquartered in Brooklyn, NY.",
					verdict: "met",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "ecommerce_brand",
					evidenceIds: [IDS.evHarbor1, IDS.evHarbor3],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale:
						"Shopify DTC brand expanding into Faire and Nordstrom wholesale.",
					verdict: "met",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "revenue_1m_10m",
					evidenceIds: [IDS.evHarbor1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale:
						"Est. fit (unreported): Private US brand passing e-commerce gate with 35 Nordstrom doors and no enterprise disqualifier.",
					verdict: "unknown",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "employees_5_50",
					evidenceIds: [IDS.evHarbor2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale:
						"Est. fit (unreported): Private brand hiring first dedicated bookkeeper reporting to COO.",
					verdict: "unknown",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "decision_maker_found",
					evidenceIds: [IDS.evHarbor2, IDS.evHarbor3],
					maxPoints: 5,
					organizationId: LEDGERWISE_ORG_ID,
					points: 5,
					rationale: "Identified Maya Lin, Co-Founder & COO.",
					verdict: "met",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "signal_hiring_finance_ops",
					evidenceIds: [IDS.evHarbor2],
					maxPoints: 25,
					organizationId: LEDGERWISE_ORG_ID,
					points: 20,
					rationale:
						"Hiring Ecommerce Bookkeeper on Ashby to reconcile Shopify and wholesale.",
					verdict: "met",
				},
				{
					companyId: IDS.compHarbor,
					criterion: "signal_channel_expansion",
					evidenceIds: [IDS.evHarbor1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale:
						"Expanded into Faire wholesale and 35 Nordstrom stores in Sept 2026.",
					verdict: "met",
				},
				// Trailhead Kettle Co. (80 pts: 15 ecomm + 15 rev met + 15 emp met + 5 contact + 20 funding + 10 expansion)
				{
					companyId: IDS.compTrailhead,
					criterion: "us_based",
					evidenceIds: [IDS.evTrailhead2],
					maxPoints: 0,
					organizationId: LEDGERWISE_ORG_ID,
					points: 0,
					rationale: "Headquartered in Denver, CO.",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "ecommerce_brand",
					evidenceIds: [IDS.evTrailhead1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale: "Sells across Shopify, Amazon FBA, and retail.",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "revenue_1m_10m",
					evidenceIds: [IDS.evTrailhead1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale:
						"Crossed $5M annual run-rate revenue (reported in July 2026 funding press).",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "employees_5_50",
					evidenceIds: [IDS.evTrailhead2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale: "26-person team in Denver, CO.",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "decision_maker_found",
					evidenceIds: [IDS.evTrailhead1],
					maxPoints: 5,
					organizationId: LEDGERWISE_ORG_ID,
					points: 5,
					rationale: "Identified Lucas Vance, Founder & CEO.",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "signal_recent_funding",
					evidenceIds: [IDS.evTrailhead1],
					maxPoints: 20,
					organizationId: LEDGERWISE_ORG_ID,
					points: 20,
					rationale: "Raised $2.8M seed round in July 2026.",
					verdict: "met",
				},
				{
					companyId: IDS.compTrailhead,
					criterion: "signal_channel_expansion",
					evidenceIds: [IDS.evTrailhead1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale: "Expanded into Amazon FBA and 140 REI retail locations.",
					verdict: "met",
				},
				// Kova Athletic (65 pts: 15 ecomm + 10 rev unknown + 10 emp unknown + 5 contact + 25 hiring)
				{
					companyId: IDS.compKova,
					criterion: "us_based",
					evidenceIds: [IDS.evKova1, IDS.evKova2],
					maxPoints: 0,
					organizationId: LEDGERWISE_ORG_ID,
					points: 0,
					rationale: "Headquartered in Los Angeles, CA.",
					verdict: "met",
				},
				{
					companyId: IDS.compKova,
					criterion: "ecommerce_brand",
					evidenceIds: [IDS.evKova2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 15,
					rationale: "Verified Shopify storefront in Los Angeles.",
					verdict: "met",
				},
				{
					companyId: IDS.compKova,
					criterion: "revenue_1m_10m",
					evidenceIds: [IDS.evKova2],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale:
						"Est. fit (unreported): Private US DTC brand with no enterprise disqualifier.",
					verdict: "unknown",
				},
				{
					companyId: IDS.compKova,
					criterion: "employees_5_50",
					evidenceIds: [IDS.evKova1],
					maxPoints: 15,
					organizationId: LEDGERWISE_ORG_ID,
					points: 10,
					rationale:
						"Est. fit (unreported): Growing ops team hiring first accounting coordinator.",
					verdict: "unknown",
				},
				{
					companyId: IDS.compKova,
					criterion: "decision_maker_found",
					evidenceIds: [IDS.evKova1],
					maxPoints: 5,
					organizationId: LEDGERWISE_ORG_ID,
					points: 5,
					rationale: "Identified Elena Rostova, VP of Operations.",
					verdict: "met",
				},
				{
					companyId: IDS.compKova,
					criterion: "signal_hiring_finance_ops",
					evidenceIds: [IDS.evKova1],
					maxPoints: 25,
					organizationId: LEDGERWISE_ORG_ID,
					points: 25,
					rationale:
						"Hiring Inventory & Accounting Coordinator on Lever for Shopify payout reconciliation.",
					verdict: "met",
				},
			])
			.onConflictDoNothing();

		// 8. Seed Contacts
		await tx
			.insert(contacts)
			.values([
				{
					companyId: IDS.compSuncrest,
					email: "clara@suncrestbotanics.com",
					emailStatus: "sandbox",
					evidenceId: IDS.evSuncrest3,
					fullName: "Clara Vance",
					id: IDS.contactSuncrest,
					organizationId: LEDGERWISE_ORG_ID,
					persona: "founder",
					title: "Founder & CEO",
				},
				{
					companyId: IDS.compHarbor,
					email: "maya@harborandloom.com",
					emailStatus: "sandbox",
					evidenceId: IDS.evHarbor3,
					fullName: "Maya Lin",
					id: IDS.contactHarbor,
					organizationId: LEDGERWISE_ORG_ID,
					persona: "coo",
					title: "Co-Founder & COO",
				},
				{
					companyId: IDS.compTrailhead,
					email: "lucas@trailheadkettle.com",
					emailStatus: "sandbox",
					evidenceId: IDS.evTrailhead1,
					fullName: "Lucas Vance",
					id: IDS.contactTrailhead,
					organizationId: LEDGERWISE_ORG_ID,
					persona: "founder",
					title: "Founder & CEO",
				},
				{
					companyId: IDS.compKova,
					email: "elena@kovaathletic.com",
					emailStatus: "sandbox",
					evidenceId: IDS.evKova1,
					fullName: "Elena Rostova",
					id: IDS.contactKova,
					organizationId: LEDGERWISE_ORG_ID,
					persona: "coo",
					title: "VP of Operations",
				},
			])
			.onConflictDoNothing();

		// 9. Seed Threads (with prospectTimezone and lowercase pending_job_id)
		await tx
			.insert(threads)
			.values([
				{
					aiMode: "auto",
					aiReplyCount: 0,
					companyId: IDS.compSuncrest,
					contactId: IDS.contactSuncrest,
					id: IDS.threadSuncrest,
					lastMessageAt: new Date("2026-11-13T17:35:00Z"),
					offeredSlots: [],
					organizationId: LEDGERWISE_ORG_ID,
					ownerUserId: LEDGERWISE_OWNER_USER_ID,
					pendingJobId: null,
					prospectTimezone: "America/Chicago",
					replyToken: "tok_suncrest_01",
					status: "awaiting_review",
				},
				{
					aiMode: "auto",
					aiReplyCount: 1,
					companyId: IDS.compHarbor,
					contactId: IDS.contactHarbor,
					id: IDS.threadHarbor,
					lastMessageAt: new Date("2026-11-13T18:10:00Z"),
					offeredSlots: [
						{
							endIso: "2026-11-16T15:30:00.000Z",
							formattedLabel: "Mon, Nov 16 at 10:00 AM ET",
							startIso: "2026-11-16T15:00:00.000Z",
							timezone: "America/New_York",
						},
						{
							endIso: "2026-11-17T19:30:00.000Z",
							formattedLabel: "Tue, Nov 17 at 2:00 PM ET",
							startIso: "2026-11-17T19:00:00.000Z",
							timezone: "America/New_York",
						},
						{
							endIso: "2026-11-18T16:30:00.000Z",
							formattedLabel: "Wed, Nov 18 at 11:00 AM ET",
							startIso: "2026-11-18T16:00:00.000Z",
							timezone: "America/New_York",
						},
					],
					organizationId: LEDGERWISE_ORG_ID,
					ownerUserId: LEDGERWISE_OWNER_USER_ID,
					pendingJobId: null,
					prospectTimezone: "America/New_York",
					replyToken: "tok_harbor_02",
					status: "active",
				},
				{
					aiMode: "auto",
					aiReplyCount: 2,
					companyId: IDS.compTrailhead,
					contactId: IDS.contactTrailhead,
					id: IDS.threadTrailhead,
					lastMessageAt: new Date("2026-11-13T18:25:00Z"),
					offeredSlots: [
						{
							endIso: "2026-11-16T19:30:00.000Z",
							formattedLabel: "Mon, Nov 16 at 12:00 PM MT (2:00 PM ET)",
							startIso: "2026-11-16T19:00:00.000Z",
							timezone: "America/Denver",
						},
					],
					organizationId: LEDGERWISE_ORG_ID,
					ownerUserId: LEDGERWISE_OWNER_USER_ID,
					pendingJobId: null,
					prospectTimezone: "America/Denver",
					replyToken: "tok_trailhead_03",
					status: "booked",
				},
				{
					aiMode: "paused",
					aiReplyCount: 0,
					companyId: IDS.compKova,
					contactId: IDS.contactKova,
					handoffReason:
						"Prospect asked about custom retail EDI 850/810 chargeback dispute automation with Dick's Sporting Goods, which is outside the Ledgerwise bookkeeping playbook.",
					id: IDS.threadKova,
					lastMessageAt: new Date("2026-11-13T18:30:00Z"),
					offeredSlots: [],
					organizationId: LEDGERWISE_ORG_ID,
					ownerUserId: LEDGERWISE_OWNER_USER_ID,
					pendingJobId: null,
					prospectTimezone: "America/Los_Angeles",
					replyToken: "tok_kova_04",
					status: "needs_human",
				},
			])
			.onConflictDoNothing();

		// 10. Seed Messages (<100 words, no physical address footer, verified citations)
		await tx
			.insert(messages)
			.values([
				{
					aiOriginalBody:
						"Hi Clara,\n\nSaw Suncrest Botanics recently closed your $3.2M seed round and that you're hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation.\n\nAt Ledgerwise, our ecommerce accounting pods run that exact Shopify, Amazon Seller Central, and 3PL landed-COGS close for growing DTC brands—delivered by the 10th business day before you even need a full-time finance hire.\n\nWorth a quick 15-minute chat next week to see if we could take the monthly close off your plate?\n\nBest,\nDana Mercer",
					author: "ai",
					bodyText:
						"Hi Clara,\n\nSaw Suncrest Botanics recently closed your $3.2M seed round and that you're hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation.\n\nAt Ledgerwise, our ecommerce accounting pods run that exact Shopify, Amazon Seller Central, and 3PL landed-COGS close for growing DTC brands—delivered by the 10th business day before you even need a full-time finance hire.\n\nWorth a quick 15-minute chat next week to see if we could take the monthly close off your plate?\n\nBest,\nDana Mercer",
					citations: [
						{
							claim: "Closed $3.2M seed round in August 2026",
							evidenceId: IDS.evSuncrest2,
							quote:
								"Austin-based skincare brand Suncrest Botanics has closed a $3.2M seed round led by Sonoma Consumer Partners",
							span: "$3.2M seed round",
							url: "https://www.beautyindependent.com/suncrest-botanics-seed-funding-2026",
						},
						{
							claim:
								"Hiring an Operations & Finance Manager in Austin for monthly close, ShipBob 3PL, and Shopify + Amazon reconciliation",
							evidenceId: IDS.evSuncrest1,
							quote:
								"We are looking for an Operations & Finance Manager in Austin, TX to manage our monthly accrual close, ShipBob 3PL inventory counts, and daily Shopify + Amazon Seller Central payout reconciliation.",
							span: "hiring an Operations & Finance Manager in Austin to handle the monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation",
							url: "https://boards.greenhouse.io/suncrestbotanics/jobs/4192831",
						},
					],
					decisionSummary:
						"Drafted 88-word personalized first email backed by 2 verified evidence quotes (0 price mentions).",
					direction: "outbound",
					factCheck: {
						claims: [
							{
								claim: "Suncrest Botanics closed a $3.2M seed round",
								evidenceId: IDS.evSuncrest2,
								rationale:
									"Directly supported by Beauty Independent seed funding quote.",
								supported: true,
							},
							{
								claim:
									"Hiring an Operations & Finance Manager in Austin for monthly close, ShipBob 3PL counts, and Shopify + Amazon payout reconciliation",
								evidenceId: IDS.evSuncrest1,
								rationale:
									"Directly supported by Greenhouse job posting quote.",
								supported: true,
							},
						],
						passed: true,
						priceMentionDetected: false,
						wordCount: 88,
					},
					id: IDS.msgSuncrestDraft,
					organizationId: LEDGERWISE_ORG_ID,
					status: "pending_review",
					subject:
						"Suncrest's Operations & Finance hire / Shopify + Amazon close",
					threadId: IDS.threadSuncrest,
				},
				// Harbor & Loom conversation
				{
					approvedBy: LEDGERWISE_OWNER_USER_ID,
					author: "ai",
					bodyText:
						"Hi Maya,\n\nCongrats on Harbor & Loom's expansion into Faire wholesale and 35 Nordstrom doors. I also noticed you're hiring an Ecommerce Bookkeeper in Brooklyn to reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS.\n\nLedgerwise runs monthly accrual bookkeeping specifically for DTC brands scaling into wholesale—reconciling Shopify, Faire, and inventory COGS by the 10th business day.\n\nOpen to a 15-minute call next week to compare notes before you hire?\n\nBest,\nDana Mercer",
					citations: [
						{
							claim: "Expanded into Faire wholesale and 35 Nordstrom doors",
							evidenceId: IDS.evHarbor1,
							quote:
								"Brooklyn-based Harbor & Loom announced its expansion beyond DTC Shopify into Faire wholesale and 35 Nordstrom home departments nationwide.",
							span: "expansion into Faire wholesale and 35 Nordstrom doors",
							url: "https://www.modernretail.co/harbor-and-loom-wholesale-expansion-2026",
						},
						{
							claim:
								"Hiring an Ecommerce Bookkeeper to reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS",
							evidenceId: IDS.evHarbor2,
							quote:
								"Reporting to Co-Founder & COO Maya Lin, the Ecommerce Bookkeeper will reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS.",
							span: "hiring an Ecommerce Bookkeeper in Brooklyn to reconcile Shopify Payments, wholesale net-60 receivables, and landed textile COGS",
							url: "https://jobs.ashbyhq.com/harborandloom/9c81a24b",
						},
					],
					decisionSummary: "Approved by Dana Mercer and sent via sandbox gate.",
					direction: "outbound",
					id: IDS.msgHarborFirst,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T17:45:00Z"),
					status: "sent",
					subject: "Harbor & Loom wholesale expansion + ecommerce bookkeeping",
					threadId: IDS.threadHarbor,
				},
				{
					author: "prospect",
					bodyText:
						"Hi Dana — timing is actually spot on. Since launching Nordstrom and Faire alongside Shopify, our landed COGS and net-60 wholesale reconciliations have been a headache. Roughly how much do you charge per month, and would you work with our existing tax CPA?",
					classification: {
						asksIfBot: false,
						confidence: 0.94,
						detectedTimezone: "America/New_York",
						intent: "pricing_inquiry",
						isOptOut: false,
						mentionsPricing: true,
						needsInfoFromHuman: false,
						rationale:
							"Prospect asks about monthly pricing and how Ledgerwise works with their existing tax CPA, expressing strong interest.",
						selectedSlotIso: null,
						wantsMeeting: true,
					},
					direction: "inbound",
					id: IDS.msgHarborInbound,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:08:00Z"),
					status: "received",
					subject:
						"Re: Harbor & Loom wholesale expansion + ecommerce bookkeeping",
					threadId: IDS.threadHarbor,
				},
				{
					author: "ai",
					bodyText:
						"Glad the timing lined up, Maya!\n\nYes—we work right alongside your existing tax CPA. We handle the monthly accrual close, Shopify + Faire payout clearing, and SKU-level landed COGS, then hand your CPA a clean, reconciled trial balance at year-end.\n\nBecause we scope our work to your monthly order volume, active wholesale channels, and inventory setup, we always walk through pricing on a quick intro call rather than quoting flat tiers over email.\n\nWould any of these 15-minute slots work for you next week?\n• Mon, Nov 16 at 10:00 AM ET\n• Tue, Nov 17 at 2:00 PM ET\n• Wed, Nov 18 at 11:00 AM ET\n\nBest,\nDana Mercer",
					decisionSummary:
						"Classified as pricing_inquiry + FAQ (0.94 confidence) → answered CPA question from playbook, deflected pricing to call (0 price leaks), and offered 3 live Cal.com slots in ET.",
					direction: "outbound",
					id: IDS.msgHarborAiReply,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:10:00Z"),
					status: "sent",
					subject:
						"Re: Harbor & Loom wholesale expansion + ecommerce bookkeeping",
					threadId: IDS.threadHarbor,
				},
				// Trailhead Kettle Co. booked conversation
				{
					approvedBy: LEDGERWISE_OWNER_USER_ID,
					author: "ai",
					bodyText:
						"Hi Lucas,\n\nCongrats on Trailhead Kettle's $2.8M seed round and crossing 140 REI doors alongside Shopify and Amazon FBA.\n\nWhen outdoor brands scale across DTC, Amazon FBA reserves, and retail wholesale at once, landed COGS and settlement clearing usually get messy fast. Ledgerwise runs dedicated ecommerce accrual bookkeeping for 20–40 person consumer brands so your channel margins stay investor-ready every month.\n\nWorth a 15-minute intro call next week?\n\nBest,\nDana Mercer",
					citations: [
						{
							claim:
								"Raised $2.8M seed round and expanded into Shopify, Amazon FBA, and 140 REI stores",
							evidenceId: IDS.evTrailhead1,
							quote:
								"Denver's Trailhead Kettle Co., led by founder Lucas Vance, raised $2.8M in seed funding after crossing $5M in annual run-rate revenue across Shopify, Amazon FBA, and 140 REI stores.",
							span: "$2.8M seed round and crossing 140 REI doors alongside Shopify and Amazon FBA",
							url: "https://www.outsidebusinessjournal.com/brands/trailhead-kettle-seed-round-2026",
						},
					],
					direction: "outbound",
					id: IDS.msgTrailheadFirst,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T16:00:00Z"),
					status: "sent",
					subject: "Trailhead Kettle's REI + Amazon FBA accounting",
					threadId: IDS.threadTrailhead,
				},
				{
					author: "prospect",
					bodyText:
						"Hey Dana, appreciate you reaching out. FBA fee settlements + REI wholesale inventory accounting is definitely our biggest pain point post-seed. What times do you have open on Monday?",
					classification: {
						asksIfBot: false,
						confidence: 0.96,
						detectedTimezone: "America/Denver",
						intent: "meeting_interest",
						isOptOut: false,
						mentionsPricing: false,
						needsInfoFromHuman: false,
						rationale:
							"Prospect wants to book an intro call on Monday (Mountain Time).",
						selectedSlotIso: null,
						wantsMeeting: true,
					},
					direction: "inbound",
					id: IDS.msgTrailheadInbound1,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:15:00Z"),
					status: "received",
					subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
					threadId: IDS.threadTrailhead,
				},
				{
					author: "ai",
					bodyText:
						"Happy to dive into how we reconcile Amazon FBA settlements and REI wholesale inventory, Lucas.\n\nHere are three times open on Monday in Mountain Time:\n• Mon, Nov 16 at 10:00 AM MT (12:00 PM ET)\n• Mon, Nov 16 at 12:00 PM MT (2:00 PM ET)\n• Mon, Nov 16 at 2:30 PM MT (4:30 PM ET)\n\nDo any of those work for you?",
					decisionSummary:
						"Detected meeting_interest (0.96 confidence) → queried Cal.com availability and offered 3 Monday slots in America/Denver (MT).",
					direction: "outbound",
					id: IDS.msgTrailheadAiSlots,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:17:00Z"),
					status: "sent",
					subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
					threadId: IDS.threadTrailhead,
				},
				{
					author: "prospect",
					bodyText: "Mon at 12:00 PM MT works great for me.",
					classification: {
						asksIfBot: false,
						confidence: 0.98,
						detectedTimezone: "America/Denver",
						intent: "slot_selection",
						isOptOut: false,
						mentionsPricing: false,
						needsInfoFromHuman: false,
						rationale:
							"Prospect unambiguously selected Monday Nov 16 at 12:00 PM MT (2026-11-16T19:00:00.000Z).",
						selectedSlotIso: "2026-11-16T19:00:00.000Z",
						wantsMeeting: true,
					},
					direction: "inbound",
					id: IDS.msgTrailheadInbound2,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:24:00Z"),
					status: "received",
					subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
					threadId: IDS.threadTrailhead,
				},
				{
					author: "ai",
					bodyText:
						"You're all set, Lucas! I've booked our 15-minute intro call for Monday, Nov 16 at 12:00 PM MT (2:00 PM ET) and sent a calendar invite with the video link to lucas@trailheadkettle.com.\n\nLooking forward to speaking on Monday!\n\nBest,\nDana Mercer",
					decisionSummary:
						"Matched offered slot 2026-11-16T19:00:00.000Z → verified slot free on Cal.com → created booking cal_bk_trailhead_01 and sent confirmation.",
					direction: "outbound",
					id: IDS.msgTrailheadConfirm,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:25:00Z"),
					status: "sent",
					subject: "Re: Trailhead Kettle's REI + Amazon FBA accounting",
					threadId: IDS.threadTrailhead,
				},
				// Kova Athletic Needs Human handoff conversation
				{
					approvedBy: LEDGERWISE_OWNER_USER_ID,
					author: "ai",
					bodyText:
						"Hi Elena,\n\nSaw Kova Athletic is hiring an Inventory & Accounting Coordinator in Los Angeles to manage Shopify payout reconciliation and 3PL inventory.\n\nLedgerwise runs monthly accrual bookkeeping, 3PL landed-COGS tracking, and daily Shopify reconciliation for growing apparel brands so your ops team doesn't have to babysit the close.\n\nWorth a 15-minute call next week to see if we can help?\n\nBest,\nDana Mercer",
					citations: [
						{
							claim:
								"Hiring an Inventory & Accounting Coordinator in Los Angeles to manage Shopify payout reconciliation and 3PL inventory",
							evidenceId: IDS.evKova1,
							quote:
								"Kova Athletic (Los Angeles, CA) is hiring an Inventory & Accounting Coordinator reporting to VP of Operations Elena Rostova to oversee Shopify payout reconciliation and 3PL inventory.",
							span: "hiring an Inventory & Accounting Coordinator in Los Angeles to manage Shopify payout reconciliation and 3PL inventory",
							url: "https://jobs.lever.co/kovaathletic/88f102c4",
						},
					],
					direction: "outbound",
					id: IDS.msgKovaFirst,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T16:30:00Z"),
					status: "sent",
					subject: "Kova Athletic's Inventory & Accounting role",
					threadId: IDS.threadKova,
				},
				{
					author: "prospect",
					bodyText:
						"Hi Dana, quick technical question before we jump on a call: do you guys handle SPS Commerce EDI 850/810 chargeback dispute portals for Dick's Sporting Goods inside NetSuite, or strictly financial bookkeeping?",
					classification: {
						asksIfBot: false,
						confidence: 0.68,
						detectedTimezone: "America/Los_Angeles",
						intent: "question",
						isOptOut: false,
						mentionsPricing: false,
						needsInfoFromHuman: true,
						rationale:
							"Prospect asks about SPS Commerce EDI 850/810 retail chargeback dispute workflows for Dick's Sporting Goods, which is not covered in the Ledgerwise playbook.",
						selectedSlotIso: null,
						wantsMeeting: false,
					},
					direction: "inbound",
					id: IDS.msgKovaInbound,
					organizationId: LEDGERWISE_ORG_ID,
					sentAt: new Date("2026-11-13T18:30:00Z"),
					status: "received",
					subject: "Re: Kova Athletic's Inventory & Accounting role",
					threadId: IDS.threadKova,
				},
				{
					author: "ai",
					bodyText:
						"Hi Elena,\n\nGreat question—we reconcile SPS Commerce EDI invoices and retail chargeback deductions on the accounting side inside NetSuite and QuickBooks so your gross-to-net wholesale margins are accurate, while your ops/3PL team submits the operational portal disputes.\n\nIf helpful, I'd love to have Dana walk you through how we structure retail chargeback reserves on a quick 15-minute call next week. Would Tuesday or Wednesday afternoon PT work?\n\nBest,\nDana Mercer",
					decisionSummary:
						"Escalated to human (needsInfoFromHuman = true, confidence 0.68 < 0.75): saved suggested reply draft for sales rep review and paused AI auto-reply.",
					direction: "outbound",
					id: IDS.msgKovaSuggested,
					organizationId: LEDGERWISE_ORG_ID,
					status: "draft",
					subject: "Re: Kova Athletic's Inventory & Accounting role",
					threadId: IDS.threadKova,
				},
			])
			.onConflictDoNothing();

		// 11. Seed Booked Meeting for Trailhead Kettle Co.
		await tx
			.insert(meetings)
			.values({
				attendeeEmail: "lucas@trailheadkettle.com",
				calBookingUid: "cal_bk_trailhead_kettle_20261116",
				companyId: IDS.compTrailhead,
				contactId: IDS.contactTrailhead,
				endAt: new Date("2026-11-16T19:15:00.000Z"),
				id: IDS.meetingTrailhead,
				meetingUrl:
					"https://app.cal.com/video/cal_bk_trailhead_kettle_20261116",
				notes:
					"15-min Intro Call: Amazon FBA settlement clearing + 140 REI retail doors inventory & COGS accounting.",
				organizationId: LEDGERWISE_ORG_ID,
				startAt: new Date("2026-11-16T19:00:00.000Z"),
				status: "scheduled",
				threadId: IDS.threadTrailhead,
				timezone: "America/Denver",
				title: "Ledgerwise × Trailhead Kettle Co. — Intro Call (Lucas Vance)",
			})
			.onConflictDoNothing();

		// 12. Seed sample AgentRun telemetry rows
		await tx.insert(agentRuns).values([
			{
				companyId: IDS.compSuncrest,
				costUsd: "0.004200",
				decision: "tier_A_score_85",
				guardResults: {
					botDisclosureValid: true,
					citationsVerified: true,
					passed: true,
					priceGuardPassed: true,
					violations: [],
					wordCountPassed: true,
				},
				inputTokens: 1840,
				latencyMs: 1420,
				messageId: IDS.msgSuncrestDraft,
				model: "openrouter/google/gemini-2.5-flash",
				organizationId: LEDGERWISE_ORG_ID,
				outputTokens: 310,
				step: "write",
				threadId: IDS.threadSuncrest,
			},
			{
				companyId: IDS.compHarbor,
				costUsd: "0.003800",
				decision: "auto_reply_pricing_deflection_with_slots",
				guardResults: {
					botDisclosureValid: true,
					citationsVerified: true,
					passed: true,
					priceGuardPassed: true,
					violations: [],
					wordCountPassed: true,
				},
				inputTokens: 1620,
				latencyMs: 1290,
				messageId: IDS.msgHarborAiReply,
				model: "openrouter/google/gemini-2.5-flash",
				organizationId: LEDGERWISE_ORG_ID,
				outputTokens: 285,
				step: "reply",
				threadId: IDS.threadHarbor,
			},
			{
				companyId: IDS.compTrailhead,
				costUsd: "0.003100",
				decision: "booked_calcom_slot",
				guardResults: {
					botDisclosureValid: true,
					citationsVerified: true,
					passed: true,
					priceGuardPassed: true,
					violations: [],
					wordCountPassed: true,
				},
				inputTokens: 1490,
				latencyMs: 1180,
				messageId: IDS.msgTrailheadConfirm,
				model: "openrouter/google/gemini-2.5-flash",
				organizationId: LEDGERWISE_ORG_ID,
				outputTokens: 210,
				step: "book",
				threadId: IDS.threadTrailhead,
			},
			{
				companyId: IDS.compKova,
				costUsd: "0.002900",
				decision: "handoff_needs_human_outside_playbook",
				guardResults: {
					botDisclosureValid: true,
					citationsVerified: true,
					passed: true,
					priceGuardPassed: true,
					violations: [],
					wordCountPassed: true,
				},
				inputTokens: 1510,
				latencyMs: 1120,
				messageId: IDS.msgKovaSuggested,
				model: "openrouter/google/gemini-2.5-flash",
				organizationId: LEDGERWISE_ORG_ID,
				outputTokens: 240,
				step: "classify",
				threadId: IDS.threadKova,
			},
		]);
	});

	return {
		organizationId: LEDGERWISE_ORG_ID,
		ownerEmail: "dana@ledgerwise.demo",
		reviewerEmail: "reviewer@ledgerwise.demo",
	};
}

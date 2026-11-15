import type { SdrIcpConfig, SdrPlaybookConfig } from "./schema";

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

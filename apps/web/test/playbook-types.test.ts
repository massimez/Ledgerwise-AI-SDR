import { describe, expect, test } from "bun:test";
import {
	draftToPayload,
	serializePayload,
	settingsToDraft,
	validatePayload,
} from "../src/app/dashboard/settings/playbook/_components/playbook-types";
import type { SdrSettingsState } from "../src/lib/sdr-types";

const TEST_SETTINGS: SdrSettingsState = {
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
		],
		differentiators: [
			"Dedicated US ecommerce accounting pod instead of generalist bookkeepers or black-box software",
		],
		pricingPolicy:
			"Never quote a price, monthly fee, or rate range in email. Pricing is scoped to monthly order volume, sales channels, and inventory complexity on a 15-minute intro call.",
		faq: [
			{
				question: "How do you reconcile Shopify and Amazon Seller Central?",
				answer:
					"We reconcile every settlement batch from Shopify Payments and Amazon Seller Central against gross orders, FBA fees, ad spend deductions, refunds, and reserve holds.",
			},
		],
		objectionHandling: [
			{
				objection: "We already have a local CPA or bookkeeper",
				responseGuidance:
					"Acknowledge that a good tax CPA is essential, and explain that generalist bookkeepers often book net bank deposits as revenue.",
			},
		],
		forbiddenTopics: [
			"Never quote dollar prices, monthly retainers, or fee ranges",
		],
		callToAction:
			"Worth a quick 15-minute intro call next week to walk through how we handle multi-channel ecommerce closes?",
	},
};

describe("playbook draft mapping and validation", () => {
	test("round-trips settings without validation errors", () => {
		const draft = settingsToDraft(TEST_SETTINGS);
		const payload = draftToPayload(draft);

		expect(validatePayload(payload)).toBeNull();
		expect(payload.playbook.services).toEqual(TEST_SETTINGS.playbook.services);
		expect(payload.playbook.objectionHandling).toEqual(
			TEST_SETTINGS.playbook.objectionHandling
		);
		expect(payload.icp).toEqual(TEST_SETTINGS.icp);
	});

	test("trims and drops blank string list items while preserving stable serialization", () => {
		const draft = settingsToDraft(TEST_SETTINGS);
		draft.services = [
			...draft.services,
			{ id: "svc_extra_blank", value: "   " },
		];

		const payload = draftToPayload(draft);
		expect(payload.playbook.services).toHaveLength(
			TEST_SETTINGS.playbook.services.length
		);
		expect(serializePayload(payload)).toBe(
			serializePayload(draftToPayload(settingsToDraft(TEST_SETTINGS)))
		);
	});

	test("flags invalid employee bounds and out-of-range daily send cap", () => {
		const draft = settingsToDraft(TEST_SETTINGS);
		draft.dailySendCap = 900;
		expect(validatePayload(draftToPayload(draft))).toContain("Daily send cap");

		draft.dailySendCap = 50;
		draft.employeeMin = 100;
		draft.employeeMax = 20;
		expect(validatePayload(draftToPayload(draft))).toContain(
			"Maximum employees"
		);
	});
});

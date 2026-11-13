import { describe, expect, it } from "bun:test";
import type { SdrPlaybookConfig } from "@workspace/db/schema/sdr";
import { evaluateGoldenReplySet } from "../evals/run-replies";
import {
	detectOutboundPriceViolation,
	verifyBotDisclosure,
} from "../src/sdr/guards";
import { detectTimezoneFromText } from "../src/sdr/reply/classifier";
import { runInboundReplyPipeline } from "../src/sdr/reply-pipeline";

const TEST_PLAYBOOK: SdrPlaybookConfig = {
	callToAction:
		"Worth a quick 15-minute intro call next week to walk through how we handle multi-channel ecommerce closes?",
	companyDescription:
		"Ledgerwise is a specialized US outsourced bookkeeping and ecommerce accounting firm that runs monthly accrual closes for DTC and omnichannel consumer brands.",
	differentiators: [
		"Dedicated US ecommerce accounting pod",
		"True gross-to-net payout clearing",
	],
	faq: [
		{
			answer:
				"We reconcile every settlement batch from Shopify Payments and Amazon Seller Central so QuickBooks matches bank deposits to the cent.",
			question: "How do you handle both Shopify and Amazon Seller Central?",
		},
		{
			answer:
				"Onboarding takes about two weeks with read-only connections to storefronts and 3PLs.",
			question: "How long does onboarding take?",
		},
		{
			answer:
				"No—we handle day-to-day ecommerce bookkeeping and hand your tax CPA a clean trial balance at year-end.",
			question: "Do you replace our tax CPA?",
		},
	],
	forbiddenTopics: ["Never quote dollar prices or retainers over email"],
	idealCustomerSummary: "US e-commerce brands ($1M–$10M)",
	objectionHandling: [
		{
			objection: "We already have a local bookkeeper or CPA",
			responseGuidance:
				"Acknowledge your tax CPA is essential; generalist bookkeepers often miss marketplace reserve clearing and landed COGS.",
		},
		{
			objection: "We use Bench / Pilot / automated software",
			responseGuidance:
				"Generic platforms often struggle with multi-channel inventory, 3PL syncs, and Amazon reserve timing.",
		},
	],
	pricingPolicy:
		"Never quote a price, monthly fee, or dollar range over email. Explain that pricing depends on monthly order volume, active sales channels, and inventory/3PL complexity.",
	services: [
		"Monthly accrual-basis bookkeeping",
		"SKU-level landed COGS and 3PL inventory valuation",
	],
};

describe("M4 Inbound Reply Pipeline & Golden Set Eval", () => {
	it("extracts prospect timezones cleanly with fallback preservation", () => {
		expect(
			detectTimezoneFromText("I'm on PST, Thursday works", "America/New_York")
		).toBe("America/Los_Angeles");
		expect(
			detectTimezoneFromText("Available 2pm CST", "America/New_York")
		).toBe("America/Chicago");
		expect(
			detectTimezoneFromText("London GMT afternoons work", "America/New_York")
		).toBe("Europe/London");
		expect(
			detectTimezoneFromText(
				"We should talk about our best closing month",
				"America/Denver"
			)
		).toBe("America/Denver");
	});

	it("escalates out-of-playbook VAT and GAAP audit questions to humans", async () => {
		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrestbotanics.demo",
			contactName: "Maya Chen",
			inboundBody:
				"Can your team file international VAT registration in Germany and handle GAAP certified audit opinions?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			prospectTimezone: "America/New_York",
			subject: "Quick question",
		});

		expect(result.action).toBe("escalate_to_human");
		expect(result.classification.intent).toBe("human_request");
		expect(result.classification.needsInfoFromHuman).toBe(true);
	});

	it("auto-answers playbook FAQ and Bench objection without leaking prices", async () => {
		const faqResult = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrestbotanics.demo",
			contactName: "Maya Chen",
			inboundBody: "How long does onboarding take?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			prospectTimezone: "America/New_York",
			subject: "Onboarding",
		});

		expect(faqResult.action).toBe("auto_send_reply");
		expect(faqResult.classification.intent).toBe("question");
		expect(faqResult.replyDraft?.body).toContain("two weeks");
		expect(
			detectOutboundPriceViolation(faqResult.replyDraft?.body ?? "")
		).toBeNull();

		const objectionResult = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrestbotanics.demo",
			contactName: "Maya Chen",
			inboundBody: "We already use Bench for our monthly books.",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			prospectTimezone: "America/New_York",
			subject: "Monthly close",
		});

		expect(objectionResult.action).toBe("auto_send_reply");
		expect(objectionResult.classification.intent).toBe("objection");
		expect(objectionResult.replyDraft?.body).toContain(
			"multi-channel inventory"
		);
	});

	it("discloses AI identity honestly AND withholds pricing on compound inquiries", async () => {
		const compound = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrestbotanics.demo",
			contactName: "Maya Chen",
			inboundBody: "Are you an AI assistant? Also what is the monthly cost?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			prospectTimezone: "America/New_York",
			subject: "Quick question",
		});

		expect(compound.action).toBe("auto_send_reply");
		expect(compound.classification.asksIfBot).toBe(true);
		expect(compound.classification.mentionsPricing).toBe(true);
		expect(verifyBotDisclosure(compound.replyDraft?.body ?? "")).toBe(true);
		expect(
			detectOutboundPriceViolation(compound.replyDraft?.body ?? "")
		).toBeNull();
	});

	it("passes all E3 50-case golden-set evaluation thresholds", async () => {
		const summary = await evaluateGoldenReplySet();

		expect(summary.totalCases).toBe(50);
		expect(summary.optOutRecall).toBe(1);
		expect(summary.priceLeakCount).toBe(0);
		expect(summary.botHonestyRate).toBe(1);
		expect(summary.actionAccuracy).toBeGreaterThanOrEqual(0.9);
		expect(summary.allGatesPassed).toBe(true);
	});
});

import { describe, expect, it } from "bun:test";
import type { OfferedSlot, SdrPlaybookConfig } from "@workspace/db/schema/sdr";
import {
	createCalcomBooking,
	detectBotQuestion,
	detectOptOutIntent,
	detectOutboundPriceViolation,
	evaluateQualificationRubric,
	fetchAvailableCalcomSlots,
	generateVerifiedFirstEmail,
	runCompanyResearchPipeline,
	runInboundReplyPipeline,
	validateFirstEmailConstraints,
	validateReplyConstraints,
	verifyBotDisclosure,
	verifyQuoteAgainstSource,
} from "../src";

const TEST_PLAYBOOK: SdrPlaybookConfig = {
	companyDescription:
		"Ledgerwise automates Shopify, Amazon, and multi-warehouse COGS bookkeeping for US e-commerce brands.",
	idealCustomerSummary: "US e-commerce brands ($1M–$10M GMV, 5–50 employees).",
	services: ["Shopify & Amazon reconciliation", "Landed COGS accounting"],
	differentiators: ["Daily payout reconciliation", "Dedicated close review"],
	pricingPolicy:
		"Pricing is scoped live on an intro call based on order volume and SKU count.",
	callToAction: "Open to a 15-minute walkthrough this week?",
	faq: [],
	objectionHandling: [],
	forbiddenTopics: ["flat pricing", "custom audit opinion"],
};

describe("M2 Guards & Verification", () => {
	it("verifies verbatim quotes via exact and >=90% fuzzy overlap and rejects fabrications", () => {
		const source =
			"Canyon Goods Co builds durable outdoor drinkware from our Austin, Texas headquarters and ships DTC via Shopify Plus.";

		expect(
			verifyQuoteAgainstSource(
				"Austin, Texas headquarters and ships DTC via Shopify Plus",
				source
			)
		).toBe(true);

		expect(
			verifyQuoteAgainstSource(
				"Canyon Goods Co builds rugged outdoor drinkware from our Austin Texas headquarters",
				source
			)
		).toBe(true);

		expect(
			verifyQuoteAgainstSource(
				"Generated $18M ARR in 2025 with 120 warehouse staff",
				source
			)
		).toBe(false);
	});

	it("catches prohibited pricing while allowing cited funding amounts", () => {
		expect(
			detectOutboundPriceViolation("Our plan is $499/mo flat fee")
		).not.toBeNull();
		expect(
			detectOutboundPriceViolation("Typical retainer is $2,500 per month")
		).not.toBeNull();
		expect(
			detectOutboundPriceViolation(
				"Congrats on your $3.2M seed round as you expand wholesale.",
				["$3.2M seed round"]
			)
		).toBeNull();
	});

	it("detects hard opt-outs reliably while avoiding false positives and quoted headers", () => {
		expect(
			detectOptOutIntent("Please unsubscribe me from this list").matched
		).toBe(true);
		expect(detectOptOutIntent("Not interested, take me off").matched).toBe(
			true
		);
		expect(
			detectOptOutIntent(
				"Sounds good! We are not interested in waiting until Q1 — let's talk.\n\n> On Nov 1 wrote:\n> unsubscribe"
			).matched
		).toBe(false);
	});

	it("validates <100-word plain-text first-email invariants cleanly", () => {
		const evidenceId = "11111111-1111-4111-8111-111111111111";
		const verifiedIds = new Set([evidenceId]);

		const valid = validateFirstEmailConstraints({
			subject: "Canyon Goods payout + COGS reconciliation",
			body: "Hi Hannah,\n\nSaw you are hiring a Senior Ecommerce Accountant while scaling Shopify Plus and Amazon payouts.\n\nBrands running multi-channel ops often lose days untangling landed inventory COGS at month-end close.\n\nWorth a quick 15-minute chat next week?",
			citations: [{ evidenceId, span: "Senior Ecommerce Accountant" }],
			verifiedEvidenceIds: verifiedIds,
		});
		expect(valid.passed).toBe(true);
		expect(valid.wordCount).toBeLessThan(100);

		const withLink = validateFirstEmailConstraints({
			subject: "Quick note",
			body: "Hi Hannah, saw your Senior Ecommerce Accountant role. Check https://ledgerwise.io for details?",
			citations: [{ evidenceId, span: "Senior Ecommerce Accountant" }],
			verifiedEvidenceIds: verifiedIds,
		});
		expect(withLink.passed).toBe(false);
		expect(withLink.reasons.some((r) => r.includes("URLs"))).toBe(true);

		const withAddress = validateFirstEmailConstraints({
			subject: "Quick note",
			body: "Hi Hannah,\n\nSaw your Senior Ecommerce Accountant role.\n\n123 Market Street, Suite 400, San Francisco, CA 94105",
			citations: [{ evidenceId, span: "Senior Ecommerce Accountant" }],
			verifiedEvidenceIds: verifiedIds,
		});
		expect(withAddress.passed).toBe(false);

		const unverifiedCitation = validateFirstEmailConstraints({
			subject: "Quick note",
			body: "Hi Hannah, saw your Senior Ecommerce Accountant role. Worth a quick call?",
			citations: [
				{
					evidenceId: "99999999-9999-4999-8999-999999999999",
					span: "Senior Ecommerce Accountant",
				},
			],
			verifiedEvidenceIds: verifiedIds,
		});
		expect(unverifiedCitation.passed).toBe(false);
	});
});

describe("M2 Qualification Rubric & Research Pipeline", () => {
	it("awards 10/15 Est. fit (unreported) for unknown revenue and unknown employees once gates pass", () => {
		const result = evaluateQualificationRubric({
			usBased: true,
			ecommerceBrand: true,
			revenueInRange: "unknown",
			employeesInRange: "unknown",
			decisionMakerFound: true,
			signalHiringFinanceOps: true,
			signalRecentFunding: true,
			signalChannelExpansion: false,
			enterpriseDisqualifier: false,
			channels: ["shopify", "amazon"],
		});

		expect(result.breakdown.revenueFit.points).toBe(10);
		expect(result.breakdown.revenueFit.label).toBe("Est. fit (unreported)");
		expect(result.breakdown.employeesFit.points).toBe(10);
		expect(result.breakdown.employeesFit.label).toBe("Est. fit (unreported)");
		expect(result.score).toBe(85);
		expect(result.tier).toBe("A");
	});

	it("disqualifies non-US or enterprise companies automatically", () => {
		const nonUs = evaluateQualificationRubric({
			usBased: false,
			ecommerceBrand: true,
			revenueInRange: "yes",
			employeesInRange: "yes",
			decisionMakerFound: true,
			signalHiringFinanceOps: true,
			signalRecentFunding: false,
			signalChannelExpansion: false,
			enterpriseDisqualifier: false,
			channels: ["shopify"],
		});
		expect(nonUs.tier).toBe("DQ");
		expect(nonUs.score).toBe(0);
	});

	it("runs research + quote verification + <100 word verified first-email draft end to end", async () => {
		const research = await runCompanyResearchPipeline({
			companyName: "Canyon Goods Co",
			domain: "canyongoods.com",
			hasDecisionMaker: true,
			openrouterApiKey: "",
			docs: [
				{
					url: "https://canyongoods.com/pages/about",
					title: "About Canyon Goods Co",
					sourceType: "website",
					fetchedAt: new Date().toISOString(),
					text: "Canyon Goods Co builds outdoor gear from Austin, TX and ships DTC on Shopify Plus and Amazon FBA.",
				},
				{
					url: "https://boards.greenhouse.io/canyongoods/jobs/1",
					title: "Senior Ecommerce Accountant",
					sourceType: "ats",
					fetchedAt: new Date().toISOString(),
					text: "We are hiring Senior Ecommerce Accountant to own Shopify payout reconciliation and inventory COGS.",
				},
			],
		});

		expect(research.evidence.length).toBeGreaterThanOrEqual(2);
		expect(research.evidence.every((item) => item.verified)).toBe(true);
		expect(["A", "B"]).toContain(research.rubric.tier);

		const email = await generateVerifiedFirstEmail({
			companyName: "Canyon Goods Co",
			evidence: research.evidence,
			firstName: "Hannah",
			openrouterApiKey: "",
		});

		expect(email.guardResult.passed).toBe(true);
		expect(email.wordCount).toBeLessThan(100);
		expect(email.citations.length).toBeGreaterThanOrEqual(1);
	});
});

describe("M3 Reply Engine, Bot Disclosure & Cal.com Integration", () => {
	it("fetches 3 deterministic slots and creates sandbox bookings when keys are unset", async () => {
		const slots = await fetchAvailableCalcomSlots({
			apiKey: "",
			eventTypeId: "",
			prospectTimezone: "America/Chicago",
		});
		expect(slots).toHaveLength(3);
		expect(slots[0]?.formattedLabel.length).toBeGreaterThan(5);

		const booking = await createCalcomBooking({
			apiKey: "",
			eventTypeId: "",
			slotStartIso: slots[0]?.startIso ?? "2026-11-18T15:00:00.000Z",
			attendeeEmail: "hannah@canyongoods.com",
			attendeeName: "Hannah Brooks",
			attendeeTimezone: "America/Chicago",
		});
		expect(booking.calBookingUid.startsWith("sim_cal_")).toBe(true);
		expect(booking.simulated).toBe(true);
	});

	it("discloses AI identity honestly when asked and refuses to quote pricing", async () => {
		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Canyon Goods Co",
			contactEmail: "hannah@canyongoods.com",
			contactName: "Hannah Brooks",
			inboundBody:
				"Are you a bot or a real person? Also how much does Ledgerwise cost per month?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			subject: "Canyon Goods payout + COGS reconciliation",
		});

		expect(detectBotQuestion("Are you a bot or a real person?")).toBe(true);
		expect(result.action).toBe("auto_send_reply");
		expect(result.classification.asksIfBot).toBe(true);
		expect(result.classification.mentionsPricing).toBe(true);
		expect(result.replyDraft).not.toBeNull();
		expect(verifyBotDisclosure(result.replyDraft?.body ?? "")).toBe(true);
		expect(
			detectOutboundPriceViolation(result.replyDraft?.body ?? "")
		).toBeNull();
		expect(result.offeredSlots).toHaveLength(3);
	});

	it("triggers immediate opt_out_halt on unsubscribe replies", async () => {
		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Canyon Goods Co",
			contactEmail: "hannah@canyongoods.com",
			contactName: "Hannah Brooks",
			inboundBody: "Please unsubscribe me and remove me from future outreach.",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			subject: "Quick question",
		});

		expect(result.action).toBe("opt_out_halt");
		expect(result.replyDraft).toBeNull();
	});

	it("books the selected offered slot cleanly and confirms booking", async () => {
		const slots: OfferedSlot[] = await fetchAvailableCalcomSlots({
			apiKey: "",
			eventTypeId: "",
			prospectTimezone: "America/New_York",
		});

		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Canyon Goods Co",
			contactEmail: "hannah@canyongoods.com",
			contactName: "Hannah Brooks",
			inboundBody: "Option 2 works great for me, let's lock that in.",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: slots,
			subject: "Re: Canyon Goods",
		});

		expect(result.action).toBe("auto_send_reply");
		expect(result.booking).not.toBeNull();
		expect(result.booking?.startTimeIso).toBe(slots[1]?.startIso ?? "");
	});

	it("escalates legal / out-of-playbook / human requests and >=3 reply cap to human review", async () => {
		const legalEscalation = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 0,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Canyon Goods Co",
			contactEmail: "hannah@canyongoods.com",
			contactName: "Hannah Brooks",
			inboundBody:
				"Can your legal team send over a custom MSA and SOC 2 Type II report?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			subject: "Re: Canyon Goods",
		});
		expect(legalEscalation.action).toBe("escalate_to_human");

		const maxCapEscalation = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 3,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Canyon Goods Co",
			contactEmail: "hannah@canyongoods.com",
			contactName: "Hannah Brooks",
			inboundBody: "Sounds good, what times work?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: [],
			subject: "Re: Canyon Goods",
		});
		expect(maxCapEscalation.action).toBe("escalate_to_human");

		const replyCheck = validateReplyConstraints({
			aiDisclosureMode: "when_asked",
			asksIfBot: true,
			body: "Hi Hannah, happy to jump on a quick walkthrough this Thursday.",
		});
		expect(replyCheck.passed).toBe(false);
		expect(replyCheck.guardResult.botDisclosureValid).toBe(false);
	});
});

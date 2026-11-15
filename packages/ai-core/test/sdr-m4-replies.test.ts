import { describe, expect, it } from "bun:test";
import { Agent } from "@mastra/core/agent";
import type { SdrPlaybookConfig } from "@workspace/db/schema/sdr";
import { evaluateGoldenReplySet } from "../evals/run-replies";
import {
	detectHardOptOutIntent,
	detectOptOutIntent,
	detectOutboundPriceViolation,
	validateReplyConstraints,
	verifyBotDisclosure,
} from "../src/sdr/guards";
import {
	assertPublicHttpUrl,
	fetchWithSsrfGuard,
	SsrfBlockedError,
} from "../src/sdr/integrations/ssrf-guard";
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
			googleApiKey: "",
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
			googleApiKey: "",
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
			googleApiKey: "",
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
			googleApiKey: "",
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

	it("reserves pre-LLM short-circuit for hard safety-net opt-outs and lets LLM resolve soft declines, indirect opt-outs, and indirect pricing without false unclear escalation", async () => {
		expect(detectHardOptOutIntent("UNSUBSCRIBE").matched).toBe(true);
		expect(detectHardOptOutIntent("STOP").matched).toBe(true);
		expect(
			detectHardOptOutIntent("No thanks to Bench, let's chat").matched
		).toBe(false);
		expect(detectOptOutIntent("No thanks to Bench, let's chat").matched).toBe(
			true
		);

		const originalGenerate = Agent.prototype.generate;
		let callMode:
			| "soft_interest"
			| "indirect_pricing_question"
			| "indirect_opt_out" = "soft_interest";
		Agent.prototype.generate = function mockGenerate(this: Agent) {
			if (this.id === "sdr-reply-classifier") {
				if (callMode === "soft_interest") {
					return Promise.resolve({
						object: {
							asksIfBot: false,
							confidence: 0.94,
							detectedTimezone: "America/New_York",
							intent: "meeting_interest",
							isOptOut: false,
							mentionsPricing: false,
							needsInfoFromHuman: false,
							rationale: "Prospect rejected competitor Bench and wants a call.",
							selectedSlotIso: null,
							wantsMeeting: true,
						},
						usage: { inputTokens: 50, outputTokens: 40 },
					});
				}
				if (callMode === "indirect_pricing_question") {
					return Promise.resolve({
						object: {
							asksIfBot: false,
							confidence: 0.91,
							detectedTimezone: "America/New_York",
							intent: "question",
							isOptOut: false,
							mentionsPricing: true,
							needsInfoFromHuman: false,
							rationale:
								"Prospect asks indirectly about retainer investment within playbook.",
							selectedSlotIso: null,
							wantsMeeting: false,
						},
						usage: { inputTokens: 50, outputTokens: 40 },
					});
				}
				return Promise.resolve({
					object: {
						asksIfBot: false,
						confidence: 0.95,
						detectedTimezone: "America/New_York",
						intent: "opt_out",
						isOptOut: true,
						mentionsPricing: false,
						needsInfoFromHuman: false,
						rationale: "Polite vendor freeze opt-out.",
						selectedSlotIso: null,
						wantsMeeting: false,
					},
					usage: { inputTokens: 50, outputTokens: 40 },
				});
			}

			return Promise.resolve({
				object: {
					body: "Happy to share how our dedicated ecommerce bookkeeping team handles multi-channel closes cleanly. We cover scope and pricing live on a brief intro call — open to a quick 15 minutes next week?",
					citedEvidenceIds: [],
					subject: "Re: Quick question",
				},
				usage: { inputTokens: 50, outputTokens: 40 },
			});
		} as unknown as typeof Agent.prototype.generate;

		try {
			callMode = "soft_interest";
			const softInterest = await runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 0,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Suncrest Botanics",
				contactEmail: "maya@suncrestbotanics.demo",
				contactName: "Maya Chen",
				googleApiKey: "google_test_key",
				inboundBody:
					"No thanks to Bench — would love to learn how you handle monthly closes.",
				openrouterApiKey: "or_test_key",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: [],
				prospectTimezone: "America/New_York",
				subject: "Quick question",
			});
			expect(softInterest.classification.intent).toBe("meeting_interest");
			expect(softInterest.classification.isOptOut).toBe(false);
			expect(softInterest.action).not.toBe("opt_out_halt");

			callMode = "indirect_pricing_question";
			const indirectPricing = await runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 0,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Suncrest Botanics",
				contactEmail: "maya@suncrestbotanics.demo",
				contactName: "Maya Chen",
				googleApiKey: "google_test_key",
				inboundBody:
					"What kind of monthly investment should a brand our stage expect?",
				openrouterApiKey: "or_test_key",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: [],
				prospectTimezone: "America/New_York",
				subject: "Quick question",
			});
			expect(indirectPricing.classification.mentionsPricing).toBe(true);
			expect(indirectPricing.classification.needsInfoFromHuman).toBe(false);
			expect(indirectPricing.action).toBe("auto_send_reply");
			expect(
				detectOutboundPriceViolation(indirectPricing.replyDraft?.body ?? "")
			).toBeNull();

			callMode = "indirect_opt_out";
			const indirectOptOut = await runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 0,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Suncrest Botanics",
				contactEmail: "maya@suncrestbotanics.demo",
				contactName: "Maya Chen",
				googleApiKey: "google_test_key",
				inboundBody:
					"We're freezing all outside vendor evaluations this year, thanks.",
				openrouterApiKey: "or_test_key",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: [],
				prospectTimezone: "America/New_York",
				subject: "Quick question",
			});
			expect(indirectOptOut.classification.isOptOut).toBe(true);
			expect(indirectOptOut.action).toBe("opt_out_halt");
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("skips AI reply generation and calendar booking when thread is paused or human-handled", async () => {
		const originalGenerate = Agent.prototype.generate;
		let llmCalls = 0;
		Agent.prototype.generate = (() => {
			llmCalls += 1;
			return Promise.resolve({
				object: {
					asksIfBot: false,
					confidence: 0.95,
					detectedTimezone: "America/New_York",
					intent: "meeting_interest",
					isOptOut: false,
					mentionsPricing: false,
					needsInfoFromHuman: false,
					rationale: "Interested in meeting",
					selectedSlotIso: null,
					wantsMeeting: true,
				},
				usage: { inputTokens: 10, outputTokens: 10 },
			});
		}) as unknown as typeof Agent.prototype.generate;

		try {
			const pausedResult = await runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 1,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Suncrest Botanics",
				contactEmail: "maya@suncrestbotanics.demo",
				contactName: "Maya Chen",
				googleApiKey: "google_test_key",
				inboundBody: "Can we book Tuesday at 2pm ET?",
				openrouterApiKey: "or_test_key",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: [],
				prospectTimezone: "America/New_York",
				subject: "Quick question",
				threadAiMode: "paused",
				threadStatus: "needs_human",
			});

			expect(pausedResult.action).toBe("escalate_to_human");
			expect(pausedResult.replyDraft).toBeNull();
			expect(pausedResult.booking).toBeNull();
			expect(pausedResult.offeredSlots).toEqual([]);
			expect(llmCalls).toBe(1);

			const humanResult = await runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 1,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Suncrest Botanics",
				contactEmail: "maya@suncrestbotanics.demo",
				contactName: "Maya Chen",
				googleApiKey: "google_test_key",
				inboundBody: "Sounds great, send over details!",
				openrouterApiKey: "or_test_key",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: [],
				prospectTimezone: "America/New_York",
				subject: "Quick question",
				threadAiMode: "auto",
				threadStatus: "human",
			});

			expect(humanResult.action).toBe("escalate_to_human");
			expect(humanResult.replyDraft).toBeNull();
			expect(humanResult.booking).toBeNull();
			expect(llmCalls).toBe(2);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("blocks pricing leaked after revenue context or inside reply subject lines", () => {
		expect(
			detectOutboundPriceViolation(
				"Congrats on your $2.5M seed round! Our retainer is $1,500/mo.",
				["$2.5M seed round"]
			)
		).not.toBeNull();
		expect(
			detectOutboundPriceViolation(
				"Congrats on your $2.5M seed round! Happy to compare notes next week.",
				["$2.5M seed round"]
			)
		).toBeNull();
		expect(
			detectOutboundPriceViolation(
				"Congrats on your $2.5M seed round! Happy to compare notes next week."
			)
		).not.toBeNull();

		const subjectCheck = validateReplyConstraints({
			aiDisclosureMode: "when_asked",
			asksIfBot: false,
			body: "Happy to walk through how we handle Shopify and Amazon closes on a quick call.",
			subject: "Re: $1,200/mo pricing question",
		});
		expect(subjectCheck.passed).toBe(false);
		expect(subjectCheck.guardResult.priceGuardPassed).toBe(false);
	});

	it("blocks private DNS targets, excessive redirects, and oversized streamed responses via SSRF guard", async () => {
		await expect(
			assertPublicHttpUrl("http://webhook.example.com/endpoint", {
				allowHttp: false,
				dnsLookup: () => Promise.resolve([{ address: "93.184.216.34" }]),
			})
		).rejects.toBeInstanceOf(SsrfBlockedError);

		await expect(
			assertPublicHttpUrl("https://metadata.internal/latest", {
				dnsLookup: () => Promise.resolve([{ address: "93.184.216.34" }]),
			})
		).rejects.toBeInstanceOf(SsrfBlockedError);

		await expect(
			assertPublicHttpUrl("https://rebind.example.com", {
				dnsLookup: () => Promise.resolve([{ address: "10.0.0.1" }]),
			})
		).rejects.toBeInstanceOf(SsrfBlockedError);

		await expect(
			assertPublicHttpUrl("https://ipv6-loopback.example.com", {
				dnsLookup: () => Promise.resolve([{ address: "::1" }]),
			})
		).rejects.toBeInstanceOf(SsrfBlockedError);

		const verified = await assertPublicHttpUrl("https://public.example.com", {
			dnsLookup: () => Promise.resolve([{ address: "93.184.216.34" }]),
		});
		expect(verified.hostname).toBe("public.example.com");

		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = ((url: string | URL) => {
				const target = String(url);
				if (target.includes("redirect-private")) {
					return Promise.resolve(
						Response.redirect("https://internal-target.example.com/", 302)
					);
				}
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("0123456789"));
						controller.enqueue(new TextEncoder().encode("abcdefghij"));
						controller.close();
					},
				});
				return Promise.resolve(
					new Response(stream, {
						headers: { "content-type": "text/html" },
						status: 200,
					})
				);
			}) as unknown as typeof fetch;

			const blockedRedirect = await fetchWithSsrfGuard(
				"https://redirect-private.example.com/start",
				{
					dnsLookup: (host) =>
						Promise.resolve([
							{
								address: host.includes("internal-target")
									? "169.254.169.254"
									: "93.184.216.34",
							},
						]),
				}
			);
			expect(blockedRedirect).toBeNull();

			const capped = await fetchWithSsrfGuard("https://brand.example.com/", {
				dnsLookup: () => Promise.resolve([{ address: "93.184.216.34" }]),
				maxBytes: 12,
			});
			expect(capped?.text).toBe("0123456789ab");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

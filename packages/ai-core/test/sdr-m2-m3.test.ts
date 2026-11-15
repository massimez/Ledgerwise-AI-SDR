import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent } from "@mastra/core/agent";
import type { OfferedSlot, SdrPlaybookConfig } from "@workspace/db/schema/sdr";
import {
	buildDiscoveryExcludeDomains,
	buildDiscoveryQueryVariations,
	createCalcomBooking,
	DEFAULT_SDR_MODEL_GEMINI,
	DISCOVERY_NICHES,
	detectBotQuestion,
	detectHeadcountBand,
	detectOptOutIntent,
	detectOutboundPriceViolation,
	discoverProspectBatch,
	discoverProspectCandidates,
	doesCompanyNameMatchHostname,
	evaluateQualificationRubric,
	fetchAvailableCalcomSlots,
	gatherCompanyResearchDocuments,
	generateVerifiedFirstEmail,
	isGenericMailboxEmail,
	researchExtractionOutputSchema,
	resolveDiscoveryStartPublishedDate,
	resolveSdrModelConfig,
	runCompanyResearchPipeline,
	runInboundReplyPipeline,
	runSdrAgentWithFallback,
	SdrLlmFallbackError,
	type SdrPipelineLogger,
	searchExaSources,
	validateFirstEmailConstraints,
	validateReplyConstraints,
	verifyBotDisclosure,
	verifyQuoteAgainstSource,
} from "../src";

const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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
			googleApiKey: "",
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
			googleApiKey: "",
			openrouterApiKey: "",
		});

		expect(email.guardResult.passed).toBe(true);
		expect(email.wordCount).toBeLessThan(100);
		expect(email.citations.length).toBeGreaterThanOrEqual(1);
	});

	it("returns only live Exa results without curated backfill when exaApiKey is set", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					results: [
						{
							title: "Northwind Ceramics — Shopify Brand",
							url: "https://northwindceramics.com/about",
							text: "Northwind Ceramics ships handcrafted ceramic cookware from Portland, Oregon via Shopify Plus and is hiring a finance controller.",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			)) as unknown as typeof fetch;

		try {
			const exaOnly = await discoverProspectCandidates({
				exaApiKey: "exa_test_key",
				existingDomains: new Set(),
				googleApiKey: "",
				openrouterApiKey: "",
				signalPreset: "hiring_finance_ops",
				targetCount: 5,
			});
			expect(exaOnly).toHaveLength(1);
			expect(exaOnly[0]?.domain).toBe("northwindceramics.com");
		} finally {
			globalThis.fetch = originalFetch;
		}
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
			googleApiKey: "",
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
			googleApiKey: "",
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
			googleApiKey: "",
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
			googleApiKey: "",
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
			googleApiKey: "",
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

describe("SDR LLM Provider Fallback (OpenRouter -> Gemini -> Error)", () => {
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of [
			"MASTRA_DEFAULT_MODEL",
			"SDR_GEMINI_MODEL",
			"SDR_MODEL_FAST",
			"SDR_MODEL_SMART",
		]) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("selects Gemini fallback when OpenRouter key is missing and prioritizes OpenRouter -> Gemini when both exist", () => {
		const geminiOnly = resolveSdrModelConfig({
			googleApiKey: "google_test_key",
			openrouterApiKey: "",
		});
		expect(geminiOnly.llmEnabled).toBe(true);
		expect(geminiOnly.hasOpenrouterKey).toBe(false);
		expect(geminiOnly.hasGoogleKey).toBe(true);
		expect(geminiOnly.fastModels).toEqual([DEFAULT_SDR_MODEL_GEMINI]);
		expect(geminiOnly.smartModels).toEqual([DEFAULT_SDR_MODEL_GEMINI]);

		const bothConfigured = resolveSdrModelConfig({
			googleApiKey: "google_test_key",
			openrouterApiKey: "or_test_key",
		});
		expect(bothConfigured.fastModels).toEqual([
			"openrouter/google/gemini-3.5-flash-lite",
			DEFAULT_SDR_MODEL_GEMINI,
		]);
		expect(bothConfigured.smartModels).toEqual([
			"openrouter/anthropic/claude-sonnet-4.5",
			DEFAULT_SDR_MODEL_GEMINI,
		]);

		const neitherConfigured = resolveSdrModelConfig({
			googleApiKey: "",
			openrouterApiKey: "",
		});
		expect(neitherConfigured.llmEnabled).toBe(false);
		expect(neitherConfigured.fastModels).toEqual([]);
	});

	it("falls back to Gemini when OpenRouter fails, and throws SdrLlmFallbackError when both fail", async () => {
		const originalGenerate = Agent.prototype.generate;
		const attemptedModels: string[] = [];

		Agent.prototype.generate = function mockGenerate(this: Agent) {
			const model = String(this.model);
			attemptedModels.push(model);
			if (model.startsWith("openrouter/")) {
				return Promise.reject(new Error("OpenRouter 429 rate limit"));
			}
			return Promise.resolve({
				object: {
					channels: ["shopify"],
					ecommerceBrand: true,
					employeesInRange: "unknown",
					enterpriseDisqualifier: false,
					facts: [],
					revenueInRange: "unknown",
					signalChannelExpansion: false,
					signalHiringFinanceOps: true,
					signalRecentFunding: false,
					summary: "Gemini fallback extracted brand profile.",
					usBased: true,
				},
				usage: { inputTokens: 120, outputTokens: 45 },
			});
		} as unknown as typeof Agent.prototype.generate;

		try {
			const result = await runCompanyResearchPipeline({
				companyName: "Canyon Goods Co",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Canyon Goods Co builds outdoor gear in Austin, TX via Shopify Plus.",
						title: "About",
						url: "https://canyongoods.com/about",
					},
				],
				domain: "canyongoods.com",
				googleApiKey: "google_test_key",
				hasDecisionMaker: true,
				openrouterApiKey: "or_test_key",
			});

			expect(attemptedModels).toEqual([
				"openrouter/google/gemini-3.5-flash-lite",
				DEFAULT_SDR_MODEL_GEMINI,
			]);
			expect(result.summary).toBe("Gemini fallback extracted brand profile.");
			expect(result.telemetry).toHaveLength(2);
			expect(result.telemetry[0]?.status).toBe("fallback");
			expect(result.telemetry[1]?.model).toBe(DEFAULT_SDR_MODEL_GEMINI);
			expect(result.telemetry[1]?.status).toBe("succeeded");

			Agent.prototype.generate = (() =>
				Promise.reject(
					new Error("Upstream API unavailable")
				)) as unknown as typeof Agent.prototype.generate;

			await expect(
				runCompanyResearchPipeline({
					companyName: "Canyon Goods Co",
					docs: [
						{
							fetchedAt: new Date().toISOString(),
							sourceType: "website",
							text: "Canyon Goods Co ships DTC via Shopify Plus.",
							title: "About",
							url: "https://canyongoods.com/about",
						},
					],
					domain: "canyongoods.com",
					googleApiKey: "google_test_key",
					hasDecisionMaker: true,
					openrouterApiKey: "or_test_key",
				})
			).rejects.toBeInstanceOf(SdrLlmFallbackError);

			await expect(
				runSdrAgentWithFallback({
					agentKey: "researchExtractorAgent",
					models: [],
					prompt: "test",
					schema: (await import("zod")).z.object({
						ok: (await import("zod")).z.boolean(),
					}),
					summarizeOutput: () => "ok",
					telemetry: [],
					telemetryAgentName: "research_extractor",
				})
			).rejects.toBeInstanceOf(SdrLlmFallbackError);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("logs redacted Exa requests/responses and tracks full research + contact email + qualification flow", async () => {
		const logs: Array<{
			context: string;
			level: string;
			message: string;
			metadata?: Record<string, unknown>;
		}> = [];
		const logger: SdrPipelineLogger = {
			info: (context, message, metadata) =>
				logs.push({ context, level: "info", message, metadata }),
			warn: (context, message, metadata) =>
				logs.push({ context, level: "warn", message, metadata }),
		};

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					results: [
						{
							title: "Lily & Fox Careers",
							url: "https://lilyandfox.com/pages/careers",
							text: "Lily & Fox is a US Shopify DTC brand hiring a Senior Cost Accountant.",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			)) as unknown as typeof fetch;

		try {
			await searchExaSources({
				apiKey: "exa_secret_should_never_log",
				logger,
				numResults: 5,
				purpose: "company_research",
				query: "lilyandfox.com",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}

		const exaReqLog = logs.find(
			(entry) =>
				entry.context === "ExaSearch" &&
				entry.message === "Sending Exa search request"
		);
		expect(exaReqLog).toBeDefined();
		expect(JSON.stringify(exaReqLog)).not.toContain(
			"exa_secret_should_never_log"
		);
		expect(exaReqLog?.metadata?.url).toBe("https://api.exa.ai/search");

		const exaResLog = logs.find(
			(entry) =>
				entry.context === "ExaSearch" &&
				entry.message === "Received Exa search response"
		);
		expect(exaResLog?.metadata?.status).toBe(200);
		expect(exaResLog?.metadata?.acceptedDocsCount).toBe(1);

		const footerPadding = "x".repeat(3700);
		const research = await runCompanyResearchPipeline({
			companyName: "Lilyandfox",
			docs: [
				{
					fetchedAt: new Date().toISOString(),
					sourceType: "exa",
					text: `Lily & Fox is a USA Shopify e-commerce brand in Elk Grove, IL hiring a Senior Cost Accountant. ${footerPadding} Reach us at help@lilyandfox.com or sarah@lilyandfox.com`,
					title: "Careers",
					url: "https://lilyandfox.com/pages/careers",
				},
			],
			domain: "lilyandfox.com",
			googleApiKey: "",
			hasDecisionMaker: false,
			logger,
			openrouterApiKey: "",
		});

		expect(research.contact?.email).toBe("sarah@lilyandfox.com");
		expect(research.contact?.emailStatus).toBe("verified");
		expect(research.rubric.tier).toBe("B");
		expect(research.rubric.breakdown.decisionMakerFit.status).toBe("fail");
		expect(
			logs.some(
				(entry) =>
					entry.context === "SdrResearchPipeline" &&
					entry.message === "Completed extraction and verification" &&
					entry.metadata?.contactEmail === "sarah@lilyandfox.com"
			)
		).toBe(true);
		expect(
			logs.some(
				(entry) =>
					entry.context === "SdrQualification" &&
					entry.message === "Evaluated qualification rubric" &&
					entry.metadata?.tier === "B"
			)
		).toBe(true);
	});

	it("discovers prospects from ATS/job-board and deep /careers URLs, resolves domains via Exa company lookup, deduplicates by resolved domain, and preserves evidenceUrl/evidenceQuote", async () => {
		const originalFetch = globalThis.fetch;
		const originalGenerate = Agent.prototype.generate;
		const fetchRequests: Array<{ category?: string; query: string }> = [];

		globalThis.fetch = ((
			_input: string | URL | Request,
			init?: RequestInit
		) => {
			const parsedBody = JSON.parse(String(init?.body ?? "{}")) as {
				category?: string;
				query: string;
			};
			fetchRequests.push(parsedBody);

			if (parsedBody.category === "company") {
				if (parsedBody.query.includes("Kestrel Roasters")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Kestrel Roasters | LinkedIn",
										url: "https://www.linkedin.com/company/kestrel-roasters",
										text: "LinkedIn profile",
									},
									{
										title: "Kestrel Roasters — Specialty Coffee",
										url: "https://kestrelroasters.com",
										text: "Kestrel Roasters official store.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				if (parsedBody.query.includes("Already Seeded")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Already Seeded",
										url: "https://alreadyseeded.com",
										text: "Official store.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				return Promise.resolve(
					new Response(JSON.stringify({ results: [] }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					})
				);
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								title:
									"Senior Ecommerce Accountant at Canyon Goods - Greenhouse",
								url: "https://job-boards.greenhouse.io/canyongoods/jobs/48102",
								text: '{"@context":"https://schema.org","hiringOrganization":{"name":"Canyon Goods Co","sameAs":"https://canyongoods.com"}} Hiring Senior Ecommerce Accountant to reconcile Shopify payouts in Austin, TX.',
							},
							{
								title: "Finance Manager - Kestrel Roasters - Workable",
								url: "https://apply.workable.com/kestrel-roasters/j/A1B2C3/",
								text: "Kestrel Roasters is hiring a Finance Manager to own inventory COGS and monthly close on Shopify.",
							},
							{
								title: "Controller | Built In",
								url: "https://builtin.com/job/controller-at-already-seeded/999",
								text: "Already Seeded is hiring a Controller for its ecommerce finance team.",
							},
							{
								title: "Accounting Lead at Suncrest Botanics",
								url: "https://www.suncrestbotanics.com/pages/careers?gh_jid=987",
								text: "Suncrest Botanics is hiring an Accounting Lead at our Portland warehouse to manage Shopify and Amazon reconciliation.",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
			);
		}) as unknown as typeof fetch;

		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					candidates: [
						{
							resultIndex: 0,
							companyName: "Canyon Goods Co",
							companyDomain: "canyongoods.com",
							evidenceQuote:
								"Hiring Senior Ecommerce Accountant to reconcile Shopify payouts in Austin, TX.",
						},
						{
							resultIndex: 1,
							companyName: "Kestrel Roasters",
							companyDomain: null,
							evidenceQuote:
								"Kestrel Roasters is hiring a Finance Manager to own inventory COGS and monthly close on Shopify.",
						},
						{
							resultIndex: 2,
							companyName: "Already Seeded",
							companyDomain: null,
							evidenceQuote:
								"Already Seeded is hiring a Controller for its ecommerce finance team.",
						},
						{
							resultIndex: 3,
							companyName: "Suncrest Botanics",
							companyDomain: null,
							evidenceQuote:
								"Suncrest Botanics is hiring an Accounting Lead at our Portland warehouse to manage Shopify and Amazon reconciliation.",
						},
					],
				},
				usage: { inputTokens: 120, outputTokens: 80 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const candidates = await discoverProspectCandidates({
				exaApiKey: "exa_test_key",
				existingDomains: new Set([
					"alreadyseeded.com",
					// Even if an old ATS host exists in DB, ATS job posts must NOT be skipped
					"job-boards.greenhouse.io",
				]),
				googleApiKey: "google_test_key",
				openrouterApiKey: "",
				signalPreset: "hiring_finance_ops",
				targetCount: 5,
			});

			expect(candidates).toHaveLength(3);

			expect(candidates[0]).toMatchObject({
				domain: "canyongoods.com",
				evidenceQuote:
					"Hiring Senior Ecommerce Accountant to reconcile Shopify payouts in Austin, TX.",
				evidenceUrl: "https://job-boards.greenhouse.io/canyongoods/jobs/48102",
				name: "Canyon Goods Co",
			});

			expect(candidates[1]).toMatchObject({
				domain: "kestrelroasters.com",
				evidenceQuote:
					"Kestrel Roasters is hiring a Finance Manager to own inventory COGS and monthly close on Shopify.",
				evidenceUrl: "https://apply.workable.com/kestrel-roasters/j/A1B2C3/",
				name: "Kestrel Roasters",
			});

			expect(candidates[2]).toMatchObject({
				domain: "suncrestbotanics.com",
				evidenceQuote:
					"Suncrest Botanics is hiring an Accounting Lead at our Portland warehouse to manage Shopify and Amazon reconciliation.",
				evidenceUrl:
					"https://www.suncrestbotanics.com/pages/careers?gh_jid=987",
				name: "Suncrest Botanics",
			});

			expect(
				fetchRequests.some(
					(req) =>
						req.category === "company" && req.query === "Kestrel Roasters"
				)
			).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("enforces dynamic startPublishedDate recency windows for time-sensitive discovery presets", async () => {
		const fixedNow = new Date("2026-11-14T12:00:00.000Z");
		expect(
			resolveDiscoveryStartPublishedDate("hiring_finance_ops", fixedNow)
		).toBe("2026-05-18T12:00:00.000Z");
		expect(resolveDiscoveryStartPublishedDate("recent_funding", fixedNow)).toBe(
			"2026-02-17T12:00:00.000Z"
		);
		expect(
			resolveDiscoveryStartPublishedDate("channel_expansion", fixedNow)
		).toBe("2025-11-14T12:00:00.000Z");
		expect(
			resolveDiscoveryStartPublishedDate(undefined, fixedNow)
		).toBeUndefined();

		const originalFetch = globalThis.fetch;
		const capturedRequests: Array<{
			category?: string;
			startPublishedDate?: string;
		}> = [];

		globalThis.fetch = ((
			_input: string | URL | Request,
			init?: RequestInit
		) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				category?: string;
				startPublishedDate?: string;
			};
			capturedRequests.push(body);
			if (body.category === "company") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							results: [
								{
									title: "Harbor & Loom",
									url: "https://harborandloom.com",
									text: "Official store.",
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } }
					)
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								title: "Harbor & Loom raises $4M seed round",
								url: "https://techcrunch.com/2026/09/10/harbor-loom-seed",
								text: "Harbor & Loom raised $4M in seed funding to expand Shopify DTC fulfillment.",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
			);
		}) as unknown as typeof fetch;

		try {
			await discoverProspectCandidates({
				exaApiKey: "exa_test_key",
				existingDomains: new Set(),
				googleApiKey: "",
				openrouterApiKey: "",
				signalPreset: "recent_funding",
				targetCount: 3,
			});

			expect(capturedRequests.length).toBeGreaterThanOrEqual(2);
			expect(capturedRequests[0]?.startPublishedDate).toMatch(
				ISO_TIMESTAMP_REGEX
			);
			const lookupReq = capturedRequests.find(
				(req) => req.category === "company"
			);
			expect(lookupReq).toBeDefined();
			expect(lookupReq?.startPublishedDate).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("blocks generic inboxes (support/info/helpme/affiliates/privacy) and fixes decisionMakerFit 0/5 when contactRole is null", async () => {
		for (const blocked of [
			"support@baublebar.com",
			"info@baublebar.com",
			"helpme@baublebar.com",
			"affiliates@baublebar.com",
			"privacy@baublebar.com",
			"customer.care@baublebar.com",
		]) {
			expect(isGenericMailboxEmail(blocked)).toBe(true);
		}
		expect(isGenericMailboxEmail("daniella@baublebar.com")).toBe(false);
		expect(isGenericMailboxEmail("daniella.yacobovsky@baublebar.com")).toBe(
			false
		);

		const originalGenerate = Agent.prototype.generate;
		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					channels: ["shopify"],
					contact: {
						email: "helpme@baublebar.com",
					},
					ecommerceBrand: true,
					employeesInRange: "unknown",
					enterpriseDisqualifier: false,
					facts: [
						{
							claim: "BaubleBar is a US jewelry ecommerce brand.",
							factType: "ecommerce",
							quote:
								"BaubleBar designs fashion jewelry in New York and ships DTC via Shopify.",
							sourceType: "website",
							url: "https://baublebar.com/pages/about",
						},
					],
					location: "New York, NY",
					revenueInRange: "unknown",
					signalChannelExpansion: false,
					signalHiringFinanceOps: false,
					signalRecentFunding: false,
					summary: "US jewelry DTC brand.",
					usBased: true,
				},
				usage: { inputTokens: 100, outputTokens: 50 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const research = await runCompanyResearchPipeline({
				companyName: "BaubleBar",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "BaubleBar designs fashion jewelry in New York and ships DTC via Shopify. Questions? Email helpme@baublebar.com, support@baublebar.com, info@baublebar.com, affiliates@baublebar.com, or privacy@baublebar.com.",
						title: "About BaubleBar",
						url: "https://baublebar.com/pages/about",
					},
				],
				domain: "baublebar.com",
				googleApiKey: "google_test",
				hasDecisionMaker: false,
				openrouterApiKey: "or_test",
			});

			expect(research.contact?.email).toBeUndefined();
			expect(research.rubric.breakdown.decisionMakerFit.status).toBe("fail");
			expect(research.rubric.breakdown.decisionMakerFit.points).toBe(0);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("runs Exa category: 'people' search per company and identifies decision-makers with verified or pattern-derived review-flagged email", async () => {
		const originalFetch = globalThis.fetch;
		const capturedRequests: Array<{ category?: string; query: string }> = [];

		globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.includes("api.exa.ai/search")) {
				const parsed = JSON.parse(String(init?.body ?? "{}")) as {
					category?: string;
					query: string;
				};
				capturedRequests.push(parsed);
				if (parsed.category === "people") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title:
											"Daniella Yacobovsky - Co-Founder - BaubleBar | LinkedIn",
										url: "https://www.linkedin.com/in/daniella-yacobovsky",
										text: "Co-Founder at BaubleBar",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				return Promise.resolve(
					new Response(
						JSON.stringify({
							results: [
								{
									title: "BaubleBar About",
									url: "https://baublebar.com/pages/about",
									text: "BaubleBar is a US ecommerce jewelry brand in New York shipping via Shopify.",
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } }
					)
				);
			}
			return Promise.resolve(new Response("Not Found", { status: 404 }));
		}) as unknown as typeof fetch;

		try {
			const docs = await gatherCompanyResearchDocuments({
				companyName: "BaubleBar",
				domain: "baublebar.com",
				exaApiKey: "exa_test_key",
			});

			const peopleReq = capturedRequests.find(
				(req) => req.category === "people"
			);
			expect(peopleReq).toBeDefined();
			expect(peopleReq?.query).toContain("Founder");
			expect(peopleReq?.query).toContain("CFO");
			expect(
				docs.some((doc) =>
					doc.url.includes("linkedin.com/in/daniella-yacobovsky")
				)
			).toBe(true);

			const research = await runCompanyResearchPipeline({
				companyName: "BaubleBar",
				docs: [
					...docs,
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Contact support@baublebar.com or helpme@baublebar.com for customer service in the United States.",
						title: "Contact BaubleBar",
						url: "https://baublebar.com/pages/contact",
					},
				],
				domain: "baublebar.com",
				googleApiKey: "",
				hasDecisionMaker: false,
				openrouterApiKey: "",
			});

			expect(research.contact?.firstName).toBe("Daniella");
			expect(research.contact?.lastName).toBe("Yacobovsky");
			expect(research.contact?.role).toBe("Co-Founder");
			expect(research.contact?.linkedinUrl).toBe(
				"https://www.linkedin.com/in/daniella-yacobovsky"
			);
			expect(research.contact?.email).toBe("daniella.yacobovsky@baublebar.com");
			expect(research.contact?.emailStatus).toBe("guessed");
			expect(research.rubric.breakdown.decisionMakerFit.status).toBe("pass");
			expect(research.rubric.breakdown.decisionMakerFit.points).toBe(5);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rotates verticalized niche queries, sends numResults: 25 + excludeDomains, retries fallback variation, and rejects trabajos.univision.com / jobs.a16z.com", async () => {
		expect(DISCOVERY_NICHES.length).toBeGreaterThanOrEqual(6);
		const variations = buildDiscoveryQueryVariations({
			keyword: "ShipBob",
			rotationSeed: 0,
			signalPreset: "hiring_finance_ops",
		});
		expect(variations).toHaveLength(DISCOVERY_NICHES.length);
		expect(variations[0]).toContain("ShipBob");
		expect(variations[0]).toContain("Bookkeeper");
		expect(variations[0]).toContain("Staff Accountant");
		expect(variations[0]).toContain("Accounting Manager");
		expect(variations[0]).toContain("Finance & Operations Manager");
		expect(variations[0]).toContain("small team");
		expect(variations[0]).toContain("founder-led");
		expect(variations[0]?.toLowerCase()).not.toContain("controller");
		const rotatedNext = buildDiscoveryQueryVariations({
			keyword: "ShipBob",
			recentQueries: variations[0] ? [variations[0]] : [],
			rotationSeed: 0,
			signalPreset: "hiring_finance_ops",
		});
		expect(rotatedNext[0]).not.toBe(variations[0]);

		const pinned = buildDiscoveryQueryVariations({
			niche: "pet_brands",
			signalPreset: "recent_funding",
		});
		expect(pinned[0]).toContain("pet");

		const originalFetch = globalThis.fetch;
		const originalGenerate = Agent.prototype.generate;
		const discoveryRequests: {
			category?: string;
			excludeDomains?: string[];
			numResults?: number;
			query: string;
		}[] = [];
		let discoveryCallCount = 0;

		globalThis.fetch = ((
			_input: string | URL | Request,
			init?: RequestInit
		) => {
			const parsed = JSON.parse(String(init?.body ?? "{}")) as {
				category?: string;
				excludeDomains?: string[];
				numResults?: number;
				query: string;
			};
			discoveryRequests.push(parsed);

			if (parsed.category === "company") {
				if (parsed.query.includes("Caldera")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Caldera + Lab Official Store",
										url: "https://calderalab.com",
										text: "Caldera + Lab men's botanical skincare brand.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				return Promise.resolve(
					new Response(
						JSON.stringify({
							results: [
								{
									title: "VeeFriends",
									url: "https://veefriends.com",
									text: "VeeFriends collectibles and e-commerce storefront.",
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } }
					)
				);
			}

			discoveryCallCount += 1;
			if (discoveryCallCount === 1) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							results: [
								{
									title: "Controller at Caldera + Lab - Univision Jobs",
									url: "https://trabajos.univision.com/job/caldera-lab-controller",
									text: "Caldera + Lab is hiring a Controller for US Shopify skincare operations.",
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } }
					)
				);
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								title: "Finance Lead at VeeFriends - a16z jobs",
								url: "https://jobs.a16z.com/jobs/veefriends-finance-lead",
								text: "VeeFriends is hiring a Finance Lead for its US ecommerce merchandise store.",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
			);
		}) as unknown as typeof fetch;

		Agent.prototype.generate = ((promptInput: unknown) => {
			const promptText = String(promptInput);
			if (promptText.includes("Caldera + Lab")) {
				return Promise.resolve({
					object: {
						candidates: [
							{
								resultIndex: 0,
								companyName: "Caldera + Lab",
								companyDomain: "trabajos.univision.com",
								evidenceQuote:
									"Caldera + Lab is hiring a Controller for US Shopify skincare operations.",
							},
						],
					},
					usage: { inputTokens: 80, outputTokens: 40 },
				});
			}
			return Promise.resolve({
				object: {
					candidates: [
						{
							resultIndex: 0,
							companyName: "VeeFriends",
							companyDomain: "jobs.a16z.com",
							evidenceQuote:
								"VeeFriends is hiring a Finance Lead for its US ecommerce merchandise store.",
						},
					],
				},
				usage: { inputTokens: 80, outputTokens: 40 },
			});
		}) as unknown as typeof Agent.prototype.generate;

		try {
			const candidates = await discoverProspectCandidates({
				exaApiKey: "exa_test_key",
				existingDomains: new Set(["alreadyowned.com"]),
				googleApiKey: "google_test_key",
				niche: "skincare_beauty",
				openrouterApiKey: "",
				rotationSeed: 0,
				signalPreset: "hiring_finance_ops",
				targetCount: 2,
			});

			const mainSearches = discoveryRequests.filter((r) => !r.category);
			expect(mainSearches).toHaveLength(2);
			expect(mainSearches[0]?.numResults).toBe(25);
			expect(mainSearches[0]?.excludeDomains).toContain("univision.com");
			expect(mainSearches[0]?.excludeDomains).toContain("a16z.com");
			expect(mainSearches[0]?.excludeDomains).toContain("simplify.jobs");
			expect(mainSearches[0]?.excludeDomains).toContain("rrm.com");
			expect(mainSearches[0]?.excludeDomains).toContain("ecom.jobs");
			expect(mainSearches[0]?.excludeDomains).toContain("jobrack.eu");
			expect(mainSearches[0]?.excludeDomains).toContain("alreadyowned.com");
			// ATS sites must remain searchable
			expect(mainSearches[0]?.excludeDomains).not.toContain("greenhouse.io");
			expect(mainSearches[0]?.excludeDomains).not.toContain("lever.co");
			// Second pass also excludes domain discovered on pass 1 and rotates query
			expect(mainSearches[1]?.excludeDomains).toContain("calderalab.com");
			expect(mainSearches[1]?.query).not.toBe(mainSearches[0]?.query);

			expect(candidates).toHaveLength(2);
			expect(candidates[0]?.domain).toBe("calderalab.com");
			expect(candidates[1]?.domain).toBe("veefriends.com");
		} finally {
			globalThis.fetch = originalFetch;
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("rejects mismatched first_party_url hosts, blocks new job boards, and validates Exa company_domain_lookup results", async () => {
		expect(doesCompanyNameMatchHostname("Birdy Grey", "birdygrey.com")).toBe(
			true
		);
		expect(
			doesCompanyNameMatchHostname("Petite Plume", "petiteplume.com")
		).toBe(true);
		expect(doesCompanyNameMatchHostname("Petite Plume", "meterwork.com")).toBe(
			false
		);
		expect(
			doesCompanyNameMatchHostname("STELLE ATHLETICA INC", "zunohire.com")
		).toBe(false);
		expect(
			doesCompanyNameMatchHostname("Kontoor Brands", "kmdbrands.com")
		).toBe(false);
		expect(
			doesCompanyNameMatchHostname("Kontoor Brands", "kontoorbrands.com")
		).toBe(true);

		const excluded = buildDiscoveryExcludeDomains([]);
		for (const board of [
			"zunohire.com",
			"meterwork.com",
			"jobsearcher.com",
			"opentoworkremote.com",
			"career.io",
		]) {
			expect(excluded).toContain(board);
		}

		const originalFetch = globalThis.fetch;
		const originalGenerate = Agent.prototype.generate;
		const lookupQueries: string[] = [];

		globalThis.fetch = ((
			_input: string | URL | Request,
			init?: RequestInit
		) => {
			const parsed = JSON.parse(String(init?.body ?? "{}")) as {
				category?: string;
				query: string;
			};
			if (parsed.category === "company") {
				lookupQueries.push(parsed.query);
				if (parsed.query === "Petite Plume") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Petite Plume — Luxury Sleepwear",
										url: "https://www.petiteplume.com",
										text: "Petite Plume designs heirloom-quality sleepwear.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				if (parsed.query === "STELLE ATHLETICA INC") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "STELLE — Activewear",
										url: "https://www.stelleshop.com",
										text: "STELLE activewear and athleisure essentials.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				if (parsed.query === "Kontoor Brands") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Kontoor Brands | LinkedIn",
										url: "https://www.linkedin.com/company/kontoor-brands",
										text: "Kontoor Brands on LinkedIn.",
									},
									{
										title: "KMD Brands Limited",
										url: "https://www.kmdbrands.com",
										text: "KMD Brands is a global outdoor company owning Kathmandu and Rip Curl.",
									},
									{
										title: "Kontoor Brands — Official Website",
										url: "https://www.kontoorbrands.com",
										text: "Kontoor Brands, Inc. is a global lifestyle apparel company.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
				if (parsed.query === "Mismatched Only Corp") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								results: [
									{
										title: "Mismatched Only Corp | ZoomInfo",
										url: "https://www.zoominfo.com/c/mismatched-only/123",
										text: "ZoomInfo profile for Mismatched Only Corp.",
									},
									{
										title: "Unrelated Apparel Co",
										url: "https://www.unrelatedapparel.com",
										text: "Unrelated Apparel Co storefront.",
									},
								],
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } }
						)
					);
				}
			}

			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								title: "Staff Accountant at Petite Plume",
								url: "https://unlisted-job-board.example/jobs/petite-plume",
								text: "Petite Plume is hiring a Staff Accountant for its US Shopify brand.",
							},
							{
								title: "Controller at STELLE ATHLETICA INC",
								url: "https://zunohire.com/jobs/stelle-athletica-controller",
								text: "STELLE ATHLETICA INC is hiring a Controller for US ecommerce operations.",
							},
							{
								title: "Accounting Manager at Birdy Grey",
								url: "https://www.birdygrey.com/pages/careers",
								text: "Birdy Grey is hiring an Accounting Manager for Shopify DTC operations.",
							},
							{
								title: "Finance Lead at Kontoor Brands",
								url: "https://boards.greenhouse.io/kontoor/jobs/1",
								text: "Kontoor Brands is hiring a Finance Lead for US apparel retail.",
							},
							{
								title: "Bookkeeper at Mismatched Only Corp",
								url: "https://boards.greenhouse.io/mismatched/jobs/2",
								text: "Mismatched Only Corp is hiring a Bookkeeper for US ecommerce.",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } }
				)
			);
		}) as unknown as typeof fetch;

		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					candidates: [
						{
							resultIndex: 0,
							companyName: "Petite Plume",
							companyDomain: null,
							evidenceQuote:
								"Petite Plume is hiring a Staff Accountant for its US Shopify brand.",
						},
						{
							resultIndex: 1,
							companyName: "STELLE ATHLETICA INC",
							companyDomain: null,
							evidenceQuote:
								"STELLE ATHLETICA INC is hiring a Controller for US ecommerce operations.",
						},
						{
							resultIndex: 2,
							companyName: "Birdy Grey",
							companyDomain: null,
							evidenceQuote:
								"Birdy Grey is hiring an Accounting Manager for Shopify DTC operations.",
						},
						{
							resultIndex: 3,
							companyName: "Kontoor Brands",
							companyDomain: null,
							evidenceQuote:
								"Kontoor Brands is hiring a Finance Lead for US apparel retail.",
						},
						{
							resultIndex: 4,
							companyName: "Mismatched Only Corp",
							companyDomain: null,
							evidenceQuote:
								"Mismatched Only Corp is hiring a Bookkeeper for US ecommerce.",
						},
					],
				},
				usage: { inputTokens: 100, outputTokens: 60 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const candidates = await discoverProspectCandidates({
				exaApiKey: "exa_test_key",
				existingDomains: new Set(),
				googleApiKey: "google_test_key",
				openrouterApiKey: "",
				signalPreset: "hiring_finance_ops",
				targetCount: 5,
			});

			expect(candidates.map((c) => c.domain)).toEqual([
				"petiteplume.com",
				"stelleshop.com",
				"birdygrey.com",
				"kontoorbrands.com",
			]);
			expect(lookupQueries).toContain("Petite Plume");
			expect(lookupQueries).toContain("STELLE ATHLETICA INC");
			expect(lookupQueries).toContain("Kontoor Brands");
			expect(lookupQueries).toContain("Mismatched Only Corp");
			expect(lookupQueries).not.toContain("Birdy Grey");
		} finally {
			globalThis.fetch = originalFetch;
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("enforces strict 5–50 numeric bounds on employee count even when LLM extraction says yes", async () => {
		expect(detectHeadcountBand("Petite Plume — 71 Employees")).toBe("no");
		expect(detectHeadcountBand("Company Size: 51-200 employees")).toBe("no");
		expect(detectHeadcountBand("4 employees")).toBe("no");
		expect(detectHeadcountBand("5 employees")).toBe("yes");
		expect(detectHeadcountBand("50 employees")).toBe("yes");
		expect(detectHeadcountBand("51 employees")).toBe("no");
		expect(detectHeadcountBand("11-50 employees")).toBe("yes");

		const originalGenerate = Agent.prototype.generate;
		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					channels: ["shopify"],
					ecommerceBrand: true,
					employeesInRange: "yes",
					enterpriseDisqualifier: false,
					facts: [
						{
							claim: "Petite Plume is a US Shopify luxury sleepwear brand.",
							factType: "ecommerce",
							quote:
								"Petite Plume designs heirloom sleepwear in the US and sells via Shopify.",
							sourceType: "website",
							url: "https://petiteplume.com/pages/about",
						},
						{
							claim: "Petite Plume has 71 Employees.",
							factType: "headcount",
							quote: "Petite Plume has 71 Employees across US operations.",
							sourceType: "exa",
							url: "https://petiteplume.com/company",
						},
					],
					location: "New York, NY",
					revenueInRange: "unknown",
					signalChannelExpansion: false,
					signalHiringFinanceOps: true,
					signalRecentFunding: false,
					summary: "US sleepwear DTC brand.",
					usBased: true,
				},
				usage: { inputTokens: 100, outputTokens: 60 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const research = await runCompanyResearchPipeline({
				companyName: "Petite Plume",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Petite Plume designs heirloom sleepwear in the US and sells via Shopify.",
						title: "About Petite Plume",
						url: "https://petiteplume.com/pages/about",
					},
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "exa",
						text: "Petite Plume has 71 Employees across US operations and is hiring an accounting manager.",
						title: "Petite Plume Overview",
						url: "https://petiteplume.com/company",
					},
				],
				domain: "petiteplume.com",
				googleApiKey: "google_test_key",
				hasDecisionMaker: true,
				openrouterApiKey: "or_test_key",
			});

			expect(research.rubric.breakdown.employeesFit.status).toBe("fail");
			expect(research.rubric.breakdown.employeesFit.points).toBe(0);
			expect(research.rubric.tier).toBe("DQ");
			expect(research.rubric.score).toBe(0);
			expect(research.rubric.disqualificationReason).toBe(
				"Reported employee count outside 5–50 ICP window."
			);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("accepts verbose summaries up to 1000 characters in researchExtractionOutputSchema and clamps pipeline summary cleanly", async () => {
		const verboseSummary =
			"Onnitlabs is a US wellness and nutrition ecommerce brand operating Shopify and Amazon storefronts. ".repeat(
				7
			);
		expect(verboseSummary.length).toBeGreaterThan(500);
		expect(verboseSummary.length).toBeLessThanOrEqual(1000);

		const parsed = researchExtractionOutputSchema.safeParse({
			channels: ["shopify", "amazon"],
			ecommerceBrand: true,
			employeesInRange: "unknown",
			enterpriseDisqualifier: false,
			facts: [],
			revenueInRange: "unknown",
			signalChannelExpansion: true,
			signalHiringFinanceOps: false,
			signalRecentFunding: false,
			summary: verboseSummary,
			usBased: true,
		});
		expect(parsed.success).toBe(true);

		const originalGenerate = Agent.prototype.generate;
		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					channels: ["shopify", "amazon"],
					ecommerceBrand: true,
					employeesInRange: "unknown",
					enterpriseDisqualifier: false,
					facts: [],
					revenueInRange: "unknown",
					signalChannelExpansion: true,
					signalHiringFinanceOps: false,
					signalRecentFunding: false,
					summary: verboseSummary,
					usBased: true,
				},
				usage: { inputTokens: 80, outputTokens: 60 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const research = await runCompanyResearchPipeline({
				companyName: "Onnitlabs",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Onnitlabs sells nutrition supplements from Austin, TX via Shopify and Amazon.",
						title: "About Onnitlabs",
						url: "https://onnit.com/pages/about",
					},
				],
				domain: "onnit.com",
				googleApiKey: "google_test_key",
				hasDecisionMaker: false,
				openrouterApiKey: "or_test_key",
			});

			expect(research.summary.length).toBeLessThanOrEqual(500);
			expect(research.summary.endsWith("...")).toBe(true);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("accepts quotes with smart quotes, diacritics, U.S./e-commerce variants, and minor mid-quote insertions", () => {
		const source =
			"Atelier Café is a U.S.-based e-commerce skincare brand — shipping 100% DTC and 100% fast Shopify — from Austin.";
		expect(
			verifyQuoteAgainstSource(
				"Atelier Cafe is a US based ecommerce skincare brand",
				source
			)
		).toBe(true);
		expect(
			verifyQuoteAgainstSource(
				"shipping 100% DTC and 100% Shopify from Austin",
				source
			)
		).toBe(true);
	});

	it("excludes linkedin.com/in/* prior-employer headcounts and client-count noise, while enforcing strict bounds on grounded reportedEmployeeCount", async () => {
		const originalGenerate = Agent.prototype.generate;
		let reportedCount = 18;
		Agent.prototype.generate = (() =>
			Promise.resolve({
				object: {
					channels: ["shopify"],
					contact: {
						firstName: "Hannah",
						isDecisionMaker: true,
						lastName: "Park",
						linkedinUrl: "https://www.linkedin.com/in/hannah-park-canyon",
						persona: "coo",
						role: "VP, Operations & Special Projects",
					},
					ecommerceBrand: true,
					employeeCountQuote: `currently operating with ${reportedCount} team members`,
					employeesInRange: "yes",
					enterpriseDisqualifier: false,
					facts: [
						{
							claim: "Canyon Goods sells on Shopify in the US.",
							factType: "ecommerce",
							quote:
								"Shopify storefront based in Austin, TX serving US customers.",
							sourceTitle: "About Canyon Goods",
							sourceType: "website",
							url: "https://canyongoods.com/about",
						},
					],
					reportedEmployeeCount: reportedCount,
					revenueInRange: "yes",
					signalChannelExpansion: false,
					signalHiringFinanceOps: false,
					signalRecentFunding: false,
					summary: "Canyon Goods is a US Shopify DTC brand.",
					usBased: true,
				},
				usage: { inputTokens: 80, outputTokens: 60 },
			})) as unknown as typeof Agent.prototype.generate;

		try {
			const linkedinNoiseDoc = {
				fetchedAt: new Date().toISOString(),
				sourceType: "press" as const,
				text: "Hannah Park previously worked at BigRetail Inc with 5,000+ employees before joining Canyon Goods.",
				title: "Hannah Park - VP Operations | LinkedIn",
				url: "https://www.linkedin.com/in/hannah-park-canyon",
			};

			reportedCount = 18;
			const qualifiedResearch = await runCompanyResearchPipeline({
				companyName: "Canyon Goods",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Canyon Goods operates a Shopify storefront based in Austin, TX serving US customers and brands with 500+ employees, currently operating with 18 team members.",
						title: "About Canyon Goods",
						url: "https://canyongoods.com/about/",
					},
					linkedinNoiseDoc,
				],
				domain: "canyongoods.com",
				googleApiKey: "google_test_key",
				hasDecisionMaker: false,
				openrouterApiKey: "or_test_key",
			});

			expect(qualifiedResearch.evidence.length).toBe(1);
			expect(qualifiedResearch.contact?.persona).toBe("coo");
			expect(qualifiedResearch.rubric.breakdown.employeesFit.status).toBe(
				"pass"
			);
			expect(qualifiedResearch.rubric.breakdown.employeesFit.points).toBe(15);
			expect(qualifiedResearch.rubric.disqualificationReason).toBeNull();

			reportedCount = 71;
			const oversizedResearch = await runCompanyResearchPipeline({
				companyName: "Canyon Goods",
				docs: [
					{
						fetchedAt: new Date().toISOString(),
						sourceType: "website",
						text: "Canyon Goods operates a Shopify storefront based in Austin, TX serving US customers and brands with 500+ employees, currently operating with 71 team members.",
						title: "About Canyon Goods",
						url: "https://canyongoods.com/about/",
					},
					linkedinNoiseDoc,
				],
				domain: "canyongoods.com",
				googleApiKey: "google_test_key",
				hasDecisionMaker: false,
				openrouterApiKey: "or_test_key",
			});

			expect(oversizedResearch.rubric.breakdown.employeesFit.status).toBe(
				"fail"
			);
			expect(oversizedResearch.rubric.breakdown.employeesFit.points).toBe(0);
			expect(oversizedResearch.rubric.disqualificationReason).toBe(
				"Reported employee count outside 5–50 ICP window."
			);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	it("retries Exa 429 RATE_LIMIT_EXCEEDED responses and matches hyphenated brand-tagline names", async () => {
		expect(
			doesCompanyNameMatchHostname("OCOA - Curly Hair Care", "ocoabeauty.com")
		).toBe(true);

		const originalFetch = globalThis.fetch;
		let attempts = 0;
		globalThis.fetch = (() => {
			attempts += 1;
			if (attempts === 1) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							error:
								"Rate limit exceeded: 10 requests per second for your team.",
							tag: "RATE_LIMIT_EXCEEDED",
						}),
						{ status: 429, statusText: "Too Many Requests" }
					)
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								publishedDate: "2026-11-10T00:00:00.000Z",
								text: "Summer Fridays is a US skincare brand selling on Shopify and Sephora.",
								title: "Summer Fridays",
								url: "https://summerfridays.com",
							},
						],
					}),
					{ status: 200 }
				)
			);
		}) as unknown as typeof fetch;

		try {
			const docs = await searchExaSources({
				apiKey: "exa_test_key",
				category: "company",
				purpose: "company_domain_lookup",
				query: "Summer Fridays",
			});
			expect(attempts).toBe(2);
			expect(docs.length).toBe(1);
			expect(docs[0]?.url).toBe("https://summerfridays.com");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns empty docs instead of fabricating a synthetic document when live fetch finds nothing", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response("", { status: 404 })
			)) as unknown as typeof fetch;

		try {
			const docs = await gatherCompanyResearchDocuments({
				companyName: "Unverified Unknown Brand",
				domain: "unverified-unknown-brand.example",
			});
			expect(docs).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("counts pre-research Exa skips and ICP pre-screen disqualifications in discoverProspectBatch", async () => {
		const originalFetch = globalThis.fetch;
		const originalGenerate = Agent.prototype.generate;
		const lookupQueries: string[] = [];
		let searchCallIndex = 0;

		Agent.prototype.generate = (async () => ({
			object: {
				candidates: [
					{
						companyDomain: null,
						companyName: "Paired Recruiting",
						evidenceQuote:
							"Paired Recruiting is a global staffing and recruiting agency in London.",
						preScreenReason: "Non-ecommerce B2B recruiting agency in UK",
						preScreenStatus: "disqualified",
						resultIndex: 0,
					},
					{
						companyDomain: "ukbrand.co.uk",
						companyName: "UK Brand",
						evidenceQuote:
							"UK Brand sells wool blankets from Manchester across the UK.",
						preScreenReason: null,
						preScreenStatus: "pass",
						resultIndex: 1,
					},
					{
						companyDomain: "alreadyseeded.com",
						companyName: "Already Seeded",
						evidenceQuote:
							"Already Seeded is a Shopify brand hiring an accountant in Austin.",
						preScreenReason: null,
						preScreenStatus: "pass",
						resultIndex: 2,
					},
					{
						companyDomain: null,
						companyName: "Unknown Aggregator Listing",
						evidenceQuote:
							"Browse top ecommerce jobs and company directories online.",
						preScreenReason: null,
						preScreenStatus: "pass",
						resultIndex: 3,
					},
					{
						companyDomain: "canyongoods.com",
						companyName: "Canyon Goods Co",
						evidenceQuote:
							"Canyon Goods Co is a US DTC brand in Austin hiring a senior accountant.",
						preScreenReason: null,
						preScreenStatus: "pass",
						resultIndex: 4,
					},
				],
			},
			text: "",
		})) as unknown as typeof Agent.prototype.generate;

		globalThis.fetch = ((input: unknown, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				category?: string;
				query?: string;
			};
			const url = String(input);
			if (!url.includes("api.exa.ai/search")) {
				return Promise.resolve(new Response("", { status: 404 }));
			}

			if (body.category === "company") {
				lookupQueries.push(body.query ?? "");
				return Promise.resolve(
					new Response(JSON.stringify({ results: [] }), { status: 200 })
				);
			}

			searchCallIndex += 1;
			if (searchCallIndex === 1) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							results: [
								{
									publishedDate: "2026-11-10T00:00:00.000Z",
									text: "Paired Recruiting is a global staffing and recruiting agency in London.",
									title: "Paired Recruiting",
									url: "https://jobs.lever.co/paired/accountant",
								},
								{
									publishedDate: "2026-11-10T00:00:00.000Z",
									text: "UK Brand sells wool blankets from Manchester across the UK.",
									title: "UK Brand",
									url: "https://ukbrand.co.uk/about",
								},
								{
									publishedDate: "2026-11-10T00:00:00.000Z",
									text: "Already Seeded is a Shopify brand hiring an accountant in Austin.",
									title: "Already Seeded",
									url: "https://alreadyseeded.com/careers",
								},
								{
									publishedDate: "2026-11-10T00:00:00.000Z",
									text: "Browse top ecommerce jobs and company directories online.",
									title: "Unknown Aggregator Listing",
									url: "https://www.linkedin.com/jobs/ecommerce-accountant",
								},
								{
									publishedDate: "2026-11-10T00:00:00.000Z",
									text: "Canyon Goods Co is a US DTC brand in Austin hiring a senior accountant.",
									title: "Canyon Goods Co",
									url: "https://canyongoods.com/careers",
								},
							],
						}),
						{ status: 200 }
					)
				);
			}

			// Second pass repeats the Canyon Goods URL (duplicate_url) and returns 0 net-new
			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								publishedDate: "2026-11-10T00:00:00.000Z",
								text: "Canyon Goods Co is a US DTC brand in Austin hiring a senior accountant.",
								title: "Canyon Goods Co",
								url: "https://canyongoods.com/careers",
							},
						],
					}),
					{ status: 200 }
				)
			);
		}) as unknown as typeof fetch;

		try {
			const batch = await discoverProspectBatch({
				exaApiKey: "exa_test_key",
				existingDomains: new Set(["alreadyseeded.com"]),
				googleApiKey: "google_test_key",
				openrouterApiKey: "",
				signalPreset: "hiring_finance_ops",
				targetCount: 3,
			});

			expect(batch.candidates).toHaveLength(1);
			expect(batch.candidates[0]?.domain).toBe("canyongoods.com");
			// Paired Recruiting was disqualified by LLM pre-screen BEFORE Exa domain lookup
			expect(lookupQueries).not.toContain("Paired Recruiting");
			expect(lookupQueries).toContain("Unknown Aggregator Listing");

			expect(batch.summary.acceptedCount).toBe(1);
			expect(batch.summary.preFilteredCount).toBe(5);
			expect(batch.summary.exaSuggestedCount).toBe(6);
			expect(batch.summary.preFilteredBreakdown).toEqual({
				duplicateDomain: 1,
				duplicateUrl: 1,
				icpPreScreen: 2,
				unresolvedDomain: 1,
			});
		} finally {
			globalThis.fetch = originalFetch;
			Agent.prototype.generate = originalGenerate;
		}
	});
});

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { RawSourceDocument } from "@workspace/ai-core";
import { db } from "@workspace/db";
import type { Job } from "bullmq";
import { parseWorkerEnv } from "../src/env";
import {
	buildSdrInboundWorkerOptions,
	buildSdrPipelineWorkerOptions,
	SDR_LLM_RATE_LIMITER,
} from "../src/lib/sdr-queues";
import { resolveOutboundDeliveryTarget } from "../src/processors/sdr/outbound/delivery-target";
import { processSdrOutboundJob } from "../src/processors/sdr/outbound/outbound.processor";
import {
	deduplicateSourceDocuments,
	loadCachedCompanySourceDocs,
	persistCompanySourceDocs,
	SOURCE_DOC_CACHE_TTL_MS,
} from "../src/processors/sdr/pipeline/pipeline.repository";
import {
	handleResearchCompany,
	type ResearchCompanyDeps,
} from "../src/processors/sdr/pipeline/research-company.handler";

describe("Worker M3 SDR Sandbox & Env Config", () => {
	it("redirects all outbound emails to SANDBOX_RECIPIENT_EMAIL in sandbox mode", () => {
		const target = resolveOutboundDeliveryTarget({
			originalRecipientEmail: "ceo@realbrand.com",
			outboundMode: "sandbox",
			sandboxRecipientEmail: "qa+sandbox@ledgerwise.io",
			subject: "Quick question on Shopify reconciliation",
		});

		expect(target.redirectedToSandbox).toBe(true);
		expect(target.toEmail).toBe("qa+sandbox@ledgerwise.io");
		expect(target.subject).toBe(
			"[SANDBOX -> ceo@realbrand.com] Quick question on Shopify reconciliation"
		);
		expect(target.allowSimulator).toBe(true);
	});

	it("marks simulated sandbox mode when SANDBOX_RECIPIENT_EMAIL is unset", () => {
		const target = resolveOutboundDeliveryTarget({
			originalRecipientEmail: "ceo@realbrand.com",
			outboundMode: "sandbox",
			sandboxRecipientEmail: "",
			subject: "Quick question",
		});

		expect(target.redirectedToSandbox).toBe(true);
		expect(target.allowSimulator).toBe(true);
		expect(target.subject).toContain("[SANDBOX SIM]");
	});

	it("targets real prospect address only when OUTBOUND_MODE=live", () => {
		const target = resolveOutboundDeliveryTarget({
			originalRecipientEmail: "ceo@realbrand.com",
			outboundMode: "live",
			sandboxRecipientEmail: "qa+sandbox@ledgerwise.io",
			subject: "Quick question",
		});

		expect(target.redirectedToSandbox).toBe(false);
		expect(target.toEmail).toBe("ceo@realbrand.com");
		expect(target.allowSimulator).toBe(false);
	});

	it("parses SDR worker env vars with safe defaults", () => {
		const env = parseWorkerEnv({});
		expect(env.OUTBOUND_MODE).toBe("sandbox");
		expect(env.SDR_MODEL_FAST).toBe("openrouter/google/gemini-3.5-flash-lite");
		expect(env.SDR_MODEL_SMART).toBe("openrouter/anthropic/claude-sonnet-4.5");
		expect(env.INBOUND_EMAIL_DOMAIN).toBe("inbox.ledgerwise.demo");
	});
});

function createDbChain<T>(result: T) {
	const chain = {
		from: () => chain,
		onConflictDoUpdate: () => Promise.resolve(result),
		// biome-ignore lint/suspicious/noThenProperty: Drizzle awaitable mock
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		values: () => chain,
		where: () => chain,
	};
	return chain;
}

describe("Worker SDR Rate Limiting & Source Doc Cache", () => {
	afterEach(() => {
		mock.restore();
	});

	it("configures BullMQ rate limiting (10 jobs/min) and capped concurrency for LLM-backed SDR workers", () => {
		expect(SDR_LLM_RATE_LIMITER).toEqual({
			duration: 60_000,
			max: 10,
		});

		const pipelineOpts = buildSdrPipelineWorkerOptions(5);
		expect(pipelineOpts.concurrency).toBe(2);
		expect(pipelineOpts.limiter).toEqual({ duration: 60_000, max: 10 });

		const inboundOpts = buildSdrInboundWorkerOptions(5);
		expect(inboundOpts.concurrency).toBe(2);
		expect(inboundOpts.limiter).toEqual({ duration: 60_000, max: 10 });

		expect(buildSdrPipelineWorkerOptions(1).concurrency).toBe(1);
	});

	it("deduplicates source documents by URL keeping the longest text", () => {
		const deduped = deduplicateSourceDocuments([
			{
				fetchedAt: "2026-11-14T10:00:00.000Z",
				sourceType: "exa",
				text: "Short snippet",
				title: "About",
				url: "https://brand.com/pages/about",
			},
			{
				fetchedAt: "2026-11-14T10:00:05.000Z",
				sourceType: "website",
				text: "Much longer direct scrape of the about page with founder details",
				title: "About Us",
				url: "https://brand.com/pages/about",
			},
			{
				fetchedAt: "2026-11-14T10:00:05.000Z",
				sourceType: "website",
				text: "Ignored empty url",
				title: "Empty",
				url: "   ",
			},
		]);

		expect(deduped).toHaveLength(1);
		expect(deduped[0]?.sourceType).toBe("website");
		expect(deduped[0]?.text).toContain("Much longer direct scrape");
	});

	it("returns fresh cached source docs, ignores expired caches, and persists deduplicated docs", async () => {
		const now = new Date();
		const stale = new Date(Date.now() - SOURCE_DOC_CACHE_TTL_MS - 60_000);

		const selectSpy = spyOn(db, "select")
			.mockImplementationOnce((() =>
				createDbChain([
					{
						companyId: "comp_1",
						createdAt: now,
						fetchedAt: now,
						id: "doc_1",
						organizationId: "org_1",
						sourceType: "exa",
						text: "Exa cached content for Canyon Goods",
						title: "Canyon Goods",
						updatedAt: now,
						url: "https://canyongoods.com/pages/about",
					},
				])) as never)
			.mockImplementationOnce((() =>
				createDbChain([
					{
						companyId: "comp_1",
						createdAt: stale,
						fetchedAt: stale,
						id: "doc_old",
						organizationId: "org_1",
						sourceType: "exa",
						text: "Expired content",
						title: "Old",
						updatedAt: stale,
						url: "https://canyongoods.com/pages/about",
					},
				])) as never);

		const freshDocs = await loadCachedCompanySourceDocs("comp_1");
		expect(freshDocs).toHaveLength(1);
		expect(freshDocs[0]?.url).toBe("https://canyongoods.com/pages/about");
		expect(freshDocs[0]?.text).toBe("Exa cached content for Canyon Goods");

		const expiredDocs = await loadCachedCompanySourceDocs("comp_1");
		expect(expiredDocs).toEqual([]);
		expect(selectSpy).toHaveBeenCalledTimes(2);

		let deletedCalled = false;
		let insertedRows: Record<string, unknown>[] = [];
		spyOn(db, "transaction").mockImplementation(((
			callback: (tx: typeof db) => Promise<unknown>
		) => callback(db)) as never);
		spyOn(db, "delete").mockImplementation((() => {
			deletedCalled = true;
			return createDbChain(undefined);
		}) as never);
		spyOn(db, "insert").mockImplementation((() => ({
			values: (rows: Record<string, unknown>[]) => {
				insertedRows = rows;
				return createDbChain(undefined);
			},
		})) as never);

		const persisted = await persistCompanySourceDocs({
			companyId: "comp_1",
			docs: [
				{
					fetchedAt: "2026-11-14T10:00:00.000Z",
					sourceType: "exa",
					text: "Short",
					title: "About",
					url: "https://canyongoods.com/pages/about",
				},
				{
					fetchedAt: "2026-11-14T10:00:01.000Z",
					sourceType: "website",
					text: "Longer website text with contact info",
					title: "About",
					url: "https://canyongoods.com/pages/about",
				},
			],
			organizationId: "org_1",
		});

		expect(deletedCalled).toBe(true);
		expect(persisted).toHaveLength(1);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]?.text).toBe("Longer website text with contact info");
	});

	it("persists gathered source docs before LLM extraction and reuses cached docs on BullMQ retry without re-calling Exa", async () => {
		const callOrder: string[] = [];
		const persistedStore = new Map<string, RawSourceDocument[]>();
		let gatherCalls = 0;
		let terminalErrorRecorded = false;

		const freshGathered: RawSourceDocument[] = [
			{
				fetchedAt: "2026-11-14T10:00:00.000Z",
				sourceType: "exa",
				text: "Canyon Goods Co is an Austin, TX DTC Shopify brand hiring an accountant.",
				title: "Canyon Goods Co - Careers",
				url: "https://canyongoods.com/pages/about",
			},
		];

		const baseDeps: Partial<ResearchCompanyDeps> = {
			createPendingReviewDraft: () => Promise.resolve("msg_draft_1"),
			findCompanyForPipeline: () =>
				Promise.resolve({
					channels: [],
					domain: "canyongoods.com",
					hqLocation: null,
					id: "comp_retry_1",
					name: "Canyon Goods Co",
					organizationId: "org_1",
				} as never),
			gatherCompanyResearchDocuments: () => {
				gatherCalls += 1;
				callOrder.push("gather");
				return Promise.resolve(freshGathered);
			},
			loadCachedCompanySourceDocs: (companyId) => {
				callOrder.push("loadCache");
				return Promise.resolve(persistedStore.get(companyId) ?? []);
			},
			loadResearchCompanyContext: () =>
				Promise.resolve({
					existingContacts: [
						{
							email: "hannah@canyongoods.com",
							fullName: "Hannah Brooks",
							id: "contact_1",
						} as never,
					],
					existingEvidence: [],
					settings: undefined,
				}),
			persistCompanyQualificationResult: () =>
				Promise.resolve({
					email: "hannah@canyongoods.com",
					fullName: "Hannah Brooks",
					id: "contact_1",
				} as never),
			persistCompanySourceDocs: ({ companyId, docs }) => {
				callOrder.push("persistCache");
				persistedStore.set(companyId, docs);
				return Promise.resolve(docs);
			},
			persistCriteriaRows: () => Promise.resolve(),
			persistResearchEvidence: ({ items }) => Promise.resolve(items),
			recordCompanyResearchError: () => {
				terminalErrorRecorded = true;
				return Promise.resolve();
			},
			recordResearchRunCompanyOutcome: () => Promise.resolve(),
			updateResearchRunProgress: () => Promise.resolve(),
		};

		// Attempt 1: LLM throws 429 rate-limit error after docs are gathered & persisted
		await expect(
			handleResearchCompany(
				{
					action: "research-company",
					companyId: "comp_retry_1",
					organizationId: "org_1",
				},
				{
					deps: {
						...baseDeps,
						runCompanyResearchPipeline: () => {
							callOrder.push("llmExtract:fail429");
							return Promise.reject(
								new Error("429 Too Many Requests: Gemini RPM limit")
							);
						},
					},
					isFinalAttempt: false,
				}
			)
		).rejects.toThrow("429 Too Many Requests");

		expect(gatherCalls).toBe(1);
		expect(terminalErrorRecorded).toBe(false);
		expect(persistedStore.get("comp_retry_1")).toHaveLength(1);
		expect(callOrder).toEqual([
			"loadCache",
			"gather",
			"persistCache",
			"llmExtract:fail429",
		]);

		// Attempt 2 (BullMQ retry): reuses persisted source docs, skips gatherCompanyResearchDocuments
		let receivedDocsOnRetry: RawSourceDocument[] = [];
		const retryResult = await handleResearchCompany(
			{
				action: "research-company",
				companyId: "comp_retry_1",
				organizationId: "org_1",
			},
			{
				deps: {
					...baseDeps,
					runCompanyResearchPipeline: ({ docs }) => {
						callOrder.push("llmExtract:success");
						receivedDocsOnRetry = docs;
						return Promise.resolve({
							channels: ["shopify"],
							evidence: [
								{
									claim: "US Shopify brand",
									factType: "ecommerce",
									id: "ev_1",
									quote: "Austin, TX DTC Shopify brand",
									sourceTitle: "Canyon Goods Co - Careers",
									sourceType: "exa",
									url: "https://canyongoods.com/pages/about",
									verified: true,
								},
							],
							rubric: {
								breakdown: {
									decisionMakerFit: {
										label: "Found",
										maxPoints: 10,
										points: 10,
										status: "met",
									},
									ecommerceBrand: {
										label: "Met",
										maxPoints: 15,
										points: 15,
										status: "met",
									},
									employeesFit: {
										label: "Est. fit (unreported)",
										maxPoints: 15,
										points: 10,
										status: "unknown",
									},
									revenueFit: {
										label: "Est. fit (unreported)",
										maxPoints: 15,
										points: 10,
										status: "unknown",
									},
									usBased: {
										label: "Met",
										maxPoints: 15,
										points: 15,
										status: "met",
									},
								},
								disqualificationReason: null,
								score: 75,
								signals: ["hiring_finance_ops"],
								tier: "A",
							},
							signals: ["hiring_finance_ops"],
							summary: "Qualified Austin DTC brand.",
							telemetry: [],
						});
					},
				},
				isFinalAttempt: false,
			}
		);

		expect(gatherCalls).toBe(1);
		expect(receivedDocsOnRetry).toEqual(freshGathered);
		expect(retryResult).toEqual({
			draftCreated: true,
			score: 75,
			tier: "A",
		});
		expect(callOrder).toEqual([
			"loadCache",
			"gather",
			"persistCache",
			"llmExtract:fail429",
			"loadCache",
			"llmExtract:success",
		]);
	});
});

function createWorkerQueryChain<T>(result: T) {
	const chain = {
		from: () => chain,
		limit: () => Promise.resolve(result),
		returning: () => Promise.resolve(result),
		set: () => chain,
		// biome-ignore lint/suspicious/noThenProperty: test double emulates Drizzle awaitable builder
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		where: () => chain,
	};
	return chain;
}

describe("Worker Outbound Send-Gate Enforcement", () => {
	afterEach(() => {
		mock.restore();
	});

	it("rejects non-sendable draft/pending_review statuses as unrecoverable", async () => {
		let selectIdx = 0;
		spyOn(db, "select").mockImplementation((() => {
			selectIdx += 1;
			if (selectIdx === 1) {
				return createWorkerQueryChain([
					{
						bodyText: "Hello from Ledgerwise",
						id: "66666666-6666-4666-8666-666666666601",
						status: "pending_review",
						subject: "Quick question",
					},
				]);
			}
			return createWorkerQueryChain([
				{
					aiReplyCount: 0,
					companyId: "comp_1",
					contactId: "cont_1",
					id: "55555555-5555-4555-8555-555555555501",
					replyToken: "reply_tok",
					status: "active",
				},
			]);
		}) as never);

		await expect(
			processSdrOutboundJob({
				attemptsMade: 0,
				data: {
					messageId: "66666666-6666-4666-8666-666666666601",
					organizationId: "org_ledgerwise",
					threadId: "55555555-5555-4555-8555-555555555501",
				},
				opts: { attempts: 3 },
			} as unknown as Job)
		).rejects.toThrow('non-sendable status "pending_review"');
	});

	it("holds approved outbound delivery without sending when daily send cap is reached", async () => {
		const selectResponses: unknown[][] = [
			[
				{
					bodyText: "Happy to schedule a quick intro call next week.",
					id: "66666666-6666-4666-8666-666666666601",
					status: "approved",
					subject: "Quick intro call",
				},
			],
			[
				{
					aiReplyCount: 0,
					companyId: "comp_1",
					contactId: "cont_1",
					id: "55555555-5555-4555-8555-555555555501",
					replyToken: "reply_tok",
					status: "active",
				},
			],
			[
				{
					email: "maya@brand.example",
					firstName: "Maya",
					lastName: "Chen",
				},
			],
			[],
			[{ dailySendCap: 5 }],
			[{ total: 5 }],
		];
		let selectIdx = 0;
		spyOn(db, "select").mockImplementation((() => {
			const result = selectResponses[selectIdx] ?? [];
			selectIdx += 1;
			return createWorkerQueryChain(result);
		}) as never);

		let heldMessage = false;
		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				update: () => {
					heldMessage = true;
					return createWorkerQueryChain([]);
				},
			};
			return await callback(txMock);
		}) as never);
		spyOn(db, "update").mockImplementation((() => {
			heldMessage = true;
			return createWorkerQueryChain([]);
		}) as never);

		const result = await processSdrOutboundJob({
			attemptsMade: 0,
			data: {
				messageId: "66666666-6666-4666-8666-666666666601",
				organizationId: "org_ledgerwise",
				threadId: "55555555-5555-4555-8555-555555555501",
			},
			opts: { attempts: 3 },
		} as unknown as Job);

		expect(heldMessage).toBe(true);
		expect(result).toEqual({
			blockedReason: "daily_send_cap",
			delivered: false,
		});
	});
});

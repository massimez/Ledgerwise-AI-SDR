import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import {
	detectOptOutIntent,
	detectOutboundPriceViolation,
} from "@workspace/ai-core";
import { db } from "@workspace/db";
import {
	companies,
	contacts,
	meetings,
	messages,
	sdrSettings,
	suppressions,
	threads,
} from "@workspace/db/schema/sdr";
import { app } from "../src/app";
import { roleAllows } from "../src/lib/auth/permissions";
import { ConflictError, ValidationError } from "../src/lib/errors";
import {
	SDR_INBOUND_QUEUE_NAME,
	SDR_OUTBOUND_QUEUE_NAME,
	SDR_PIPELINE_QUEUE_NAME,
	sdrInboundJobDataSchema,
	sdrOutboundJobDataSchema,
	sdrPipelineJobDataSchema,
} from "../src/lib/queues";
import {
	approveReviewMessage,
	rejectReviewMessage,
} from "../src/modules/sdr/review/review.service";
import {
	importCompanyUrlSchema,
	listCompaniesQuerySchema,
	regenerateDraftSchema,
	startResearchRunSchema,
	updateCompanySchema,
} from "../src/modules/sdr/schema";
import { executeAndPersistInboundReply } from "../src/modules/sdr/threads/inbound-executor";
import { suppressBouncedContacts } from "../src/modules/webhooks/resend/resend.repository";
import {
	verifyHmacSignature,
	verifyResendWebhookSignature,
} from "../src/modules/webhooks/route";

describe("Ledgerwise SDR RBAC, queue contracts, and deterministic safety guards", () => {
	test("enforces SDR resource permissions across owner, admin, member, and viewer roles", () => {
		expect(roleAllows("owner", "lead", "research")).toBe(true);
		expect(roleAllows("owner", "lead", "qualify")).toBe(true);
		expect(roleAllows("admin", "lead", "qualify")).toBe(true);
		expect(roleAllows("member", "lead", "qualify")).toBe(true);
		expect(roleAllows("viewer", "lead", "qualify")).toBe(false);
		expect(roleAllows("admin", "outreach", "approve")).toBe(true);
		expect(roleAllows("member", "outreach", "approve")).toBe(true);
		expect(roleAllows("member", "conversation", "takeover")).toBe(true);
		expect(roleAllows("member", "playbook", "update")).toBe(false);
		expect(roleAllows("admin", "playbook", "update")).toBe(true);
		expect(roleAllows("viewer", "lead", "read")).toBe(true);
		expect(roleAllows("viewer", "outreach", "approve")).toBe(false);
	});

	test("validates SDR pipeline, outbound, and inbound BullMQ job schemas", () => {
		expect(SDR_PIPELINE_QUEUE_NAME).toBe("sdr-pipeline-queue");
		expect(SDR_OUTBOUND_QUEUE_NAME).toBe("sdr-outbound-queue");
		expect(SDR_INBOUND_QUEUE_NAME).toBe("sdr-inbound-queue");

		expect(
			sdrPipelineJobDataSchema.safeParse({
				action: "discover-batch",
				organizationId: "org_ledgerwise",
				researchRunId: "11111111-1111-4111-8111-111111111101",
				startedByUserId: "user_1",
				targetCount: 30,
			}).success
		).toBe(true);

		expect(
			sdrOutboundJobDataSchema.safeParse({
				messageId: "66666666-6666-4666-8666-666666666601",
				organizationId: "org_ledgerwise",
				threadId: "55555555-5555-4555-8555-555555555501",
			}).success
		).toBe(true);

		expect(
			sdrInboundJobDataSchema.safeParse({
				inboundMessageId: "66666666-6666-4666-8666-666666666602",
				organizationId: "org_ledgerwise",
				source: "simulator",
				threadId: "55555555-5555-4555-8555-555555555501",
			}).success
		).toBe(true);
	});

	test("detects outbound price violations deterministically (Invariant #2: Never Quote Pricing)", () => {
		expect(
			detectOutboundPriceViolation(
				"Our bookkeeping package starts at $500 per month."
			) !== null
		).toBe(true);

		expect(
			detectOutboundPriceViolation(
				"We charge a flat monthly fee for Shopify reconciliation."
			) !== null
		).toBe(true);

		expect(
			detectOutboundPriceViolation(
				"We tailor our scope on a 20-minute call once we see your Shopify, Amazon, and 3PL volume."
			) !== null
		).toBe(false);
	});

	test("detects hard opt-out / unsubscribe intent deterministically (Invariant #3)", () => {
		expect(
			detectOptOutIntent("Please unsubscribe me and remove me from your list.")
				.matched
		).toBe(true);
		expect(
			detectOptOutIntent("We are not interested, stop emailing me.").matched
		).toBe(true);
		expect(
			detectOptOutIntent(
				"2:00 PM Central works well for me, let's book the call."
			).matched
		).toBe(false);
	});

	test("verifies Resend Svix and Cal.com HMAC-SHA256 webhook signatures", async () => {
		const payload = JSON.stringify({
			triggerEvent: "BOOKING_CREATED",
			payload: {},
		});
		const calSecret = "cal_secret_test_key";
		const hexSig = createHmac("sha256", calSecret)
			.update(payload)
			.digest("hex");

		expect(
			verifyHmacSignature({
				payload,
				secret: calSecret,
				signatureHeader: hexSig,
			})
		).toBe(true);
		expect(
			verifyHmacSignature({
				payload,
				secret: calSecret,
				signatureHeader: "bad_signature",
			})
		).toBe(false);

		const svixSecretRaw = Buffer.from("super_secret_svix_signing_key").toString(
			"base64"
		);
		const svixId = "msg_12345";
		const svixTimestamp = Math.floor(Date.now() / 1000).toString();
		const svixSigBase64 = createHmac(
			"sha256",
			Buffer.from(svixSecretRaw, "base64")
		)
			.update(`${svixId}.${svixTimestamp}.${payload}`)
			.digest("base64");

		expect(
			verifyResendWebhookSignature({
				payload,
				secret: `whsec_${svixSecretRaw}`,
				svixId,
				svixTimestamp,
				svixSignature: `v1,${svixSigBase64}`,
			})
		).toBe(true);
		expect(
			verifyResendWebhookSignature({
				payload,
				secret: `whsec_${svixSecretRaw}`,
				svixId,
				svixTimestamp,
				svixSignature: "v1,invalid",
			})
		).toBe(false);

		const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
		const staleSig = createHmac("sha256", Buffer.from(svixSecretRaw, "base64"))
			.update(`${svixId}.${staleTimestamp}.${payload}`)
			.digest("base64");
		expect(
			verifyResendWebhookSignature({
				payload,
				secret: `whsec_${svixSecretRaw}`,
				svixId,
				svixTimestamp: staleTimestamp,
				svixSignature: `v1,${staleSig}`,
			})
		).toBe(false);

		// Confirm webhook route fails closed (401 signature error) without exposing session auth barriers
		const res = await app.request("/api/webhooks/calcom", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload,
		});
		expect(res.status).toBe(401);
	});

	test("mounts all modular SDR submodule routes behind authentication (401 rather than 404)", async () => {
		const routes: Array<{ method: string; path: string }> = [
			{ method: "GET", path: "/api/sdr/dashboard" },
			{ method: "GET", path: "/api/sdr/companies" },
			{ method: "POST", path: "/api/sdr/companies/import" },
			{
				method: "GET",
				path: "/api/sdr/companies/11111111-1111-4111-8111-111111111111",
			},
			{
				method: "PATCH",
				path: "/api/sdr/companies/11111111-1111-4111-8111-111111111111",
			},
			{ method: "GET", path: "/api/sdr/review" },
			{
				method: "POST",
				path: "/api/sdr/review/11111111-1111-4111-8111-111111111111/approve",
			},
			{
				method: "POST",
				path: "/api/sdr/review/11111111-1111-4111-8111-111111111111/reject",
			},
			{
				method: "POST",
				path: "/api/sdr/review/11111111-1111-4111-8111-111111111111/regenerate",
			},
			{ method: "GET", path: "/api/sdr/threads" },
			{
				method: "GET",
				path: "/api/sdr/threads/11111111-1111-4111-8111-111111111111",
			},
			{ method: "GET", path: "/api/sdr/meetings" },
			{ method: "GET", path: "/api/sdr/settings" },
			{ method: "PUT", path: "/api/sdr/settings" },
			{ method: "POST", path: "/api/sdr/settings/reset-demo" },
			{ method: "GET", path: "/api/sdr/research/runs" },
			{ method: "POST", path: "/api/sdr/research/runs" },
		];

		const responses = await Promise.all(
			routes.map((route) => app.request(route.path, { method: route.method }))
		);

		for (const res of responses) {
			expect(res.status).toBe(401);
		}
	});

	test("validates SDR submodule request schemas for research, company import/update, and draft regeneration", () => {
		expect(
			startResearchRunSchema.safeParse({
				queries: ["shopify skincare brands usa"],
				targetCount: 25,
			}).success
		).toBe(true);
		expect(startResearchRunSchema.safeParse({ targetCount: 100 }).success).toBe(
			false
		);

		expect(
			importCompanyUrlSchema.safeParse({
				website: "https://hearthandpine.com",
				name: "Hearth & Pine",
			}).success
		).toBe(true);
		expect(
			importCompanyUrlSchema.safeParse({ website: "not-a-url" }).success
		).toBe(false);

		expect(
			updateCompanySchema.safeParse({
				tier: "A",
				status: "qualified",
			}).success
		).toBe(true);
		expect(
			updateCompanySchema.safeParse({
				hidden: true,
			}).success
		).toBe(true);

		const parsedCompanyQuery = listCompaniesQuerySchema.safeParse({
			includeHidden: "false",
			limit: "10",
			offset: "20",
			sort: "name_asc",
		});
		expect(parsedCompanyQuery.success).toBe(true);
		if (parsedCompanyQuery.success) {
			expect(parsedCompanyQuery.data.includeHidden).toBe(false);
			expect(parsedCompanyQuery.data.limit).toBe(10);
			expect(parsedCompanyQuery.data.offset).toBe(20);
			expect(parsedCompanyQuery.data.sort).toBe("name_asc");
		}
		expect(
			listCompaniesQuerySchema.safeParse({
				includeHidden: "true",
				sort: "oldest",
			}).success
		).toBe(true);
		expect(
			regenerateDraftSchema.safeParse({
				instruction: "Lead with Shopify POS reconciliation pain.",
			}).success
		).toBe(true);

		expect(
			startResearchRunSchema.safeParse({
				signalPreset: "hiring_finance_ops",
			}).success
		).toBe(true);

		expect(
			startResearchRunSchema.safeParse({
				keyword: "supplements",
				limit: 10,
				signalPreset: "recent_funding",
			}).success
		).toBe(true);

		// Hard cap at 10 per run to protect Exa/OpenRouter credits
		expect(
			startResearchRunSchema.safeParse({
				limit: 11,
				signalPreset: "channel_expansion",
			}).success
		).toBe(false);
		expect(
			startResearchRunSchema.safeParse({
				signalPreset: "channel_expansion",
				targetCount: 15,
			}).success
		).toBe(false);

		expect(
			sdrPipelineJobDataSchema.safeParse({
				action: "discover-batch",
				keyword: "skincare",
				organizationId: "org_ledgerwise",
				queries: ["US Shopify ecommerce brand hiring accountant"],
				researchRunId: "11111111-1111-4111-8111-111111111101",
				signalPreset: "hiring_finance_ops",
				targetCount: 5,
			}).success
		).toBe(true);
	});
});

function createTableSelectChain(
	resolver: (table: unknown, callIndex: number) => unknown[],
	callIndex: number
) {
	let resolved: unknown[] = [];
	const chain = {
		from: (table: unknown) => {
			resolved = resolver(table, callIndex);
			return chain;
		},
		limit: () => Promise.resolve(resolved),
		orderBy: () => chain,
		// biome-ignore lint/suspicious/noThenProperty: test double emulates Drizzle awaitable builder
		then: <R>(
			onfulfilled?: (value: unknown[]) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(resolved).then(onfulfilled, onrejected),
		where: () => chain,
	};
	return chain;
}

describe("SDR send caps, idempotency, review status guards, and bounce suppression", () => {
	afterEach(() => {
		mock.restore();
	});

	test("approveReviewMessage rejects when daily send cap is reached", async () => {
		let selectCalls = 0;
		spyOn(db, "select").mockImplementation((() => {
			selectCalls += 1;
			return createTableSelectChain((table, idx) => {
				if (table === messages) {
					if (idx === 1) {
						return [
							{
								bodyText: "Happy to walk through your Shopify payout closes.",
								citations: [],
								id: "msg_1",
								organizationId: "org_1",
								status: "pending_review",
								subject: "Quick question",
								threadId: "thr_1",
							},
						];
					}
					return [{ total: 10 }];
				}
				if (table === threads) {
					return [
						{
							companyId: "comp_1",
							contactId: "cont_1",
							id: "thr_1",
							lastMessageAt: new Date("2026-11-14T12:00:00Z"),
							status: "pending_review",
						},
					];
				}
				if (table === contacts) {
					return [{ email: "founder@brand.com", id: "cont_1" }];
				}
				if (table === suppressions) {
					return [];
				}
				if (table === sdrSettings) {
					return [{ dailySendCap: 10 }];
				}
				return [];
			}, selectCalls);
		}) as never);

		await expect(
			approveReviewMessage({
				messageId: "msg_1",
				organizationId: "org_1",
				userId: "user_1",
			})
		).rejects.toBeInstanceOf(ValidationError);
	});

	test("rejectReviewMessage throws ConflictError when draft is no longer pending_review", async () => {
		spyOn(db, "select").mockImplementation((() =>
			createTableSelectChain(
				() => [
					{
						id: "msg_sent",
						organizationId: "org_1",
						status: "sent",
						threadId: "thr_1",
					},
				],
				1
			)) as never);

		await expect(
			rejectReviewMessage({
				messageId: "msg_sent",
				organizationId: "org_1",
				reason: "No longer needed",
			})
		).rejects.toBeInstanceOf(ConflictError);
	});

	test("executeAndPersistInboundReply returns already_processed without calling LLM when classification exists", async () => {
		let llmCalls = 0;
		const originalGenerate = Agent.prototype.generate;
		Agent.prototype.generate = (() => {
			llmCalls += 1;
			throw new Error("LLM should not be called on already processed inbound");
		}) as unknown as typeof Agent.prototype.generate;

		try {
			let selectCalls = 0;
			spyOn(db, "select").mockImplementation((() => {
				selectCalls += 1;
				return createTableSelectChain((table, idx) => {
					if (table === messages && idx <= 2) {
						return [
							{
								bodyText: "Yes, Tuesday at 2pm works.",
								classification: {
									asksIfBot: false,
									confidence: 0.95,
									intent: "meeting_interest",
									isOptOut: false,
									mentionsPricing: false,
									needsInfoFromHuman: false,
									rationale: "Already processed",
									selectedSlotIso: null,
									wantsMeeting: true,
								},
								createdAt: new Date("2026-11-14T12:00:00Z"),
								direction: "inbound",
								id: "in_msg_1",
								organizationId: "org_1",
								subject: "Re: Quick question",
								threadId: "thr_1",
							},
						];
					}
					if (table === messages) {
						return [];
					}
					if (table === threads) {
						return [
							{
								aiMode: "auto",
								aiReplyCount: 1,
								companyId: "comp_1",
								contactId: "cont_1",
								id: "thr_1",
								offeredSlots: [],
								prospectTimezone: "America/New_York",
								status: "active",
							},
						];
					}
					if (table === companies) {
						return [{ id: "comp_1", name: "Suncrest Botanics" }];
					}
					if (table === sdrSettings) {
						return [
							{
								aiDisclosureMode: "when_asked",
								autopilotMode: "replies_auto",
								organizationId: "org_1",
								playbook: {},
							},
						];
					}
					if (table === contacts) {
						return [
							{
								email: "maya@suncrest.com",
								firstName: "Maya",
								id: "cont_1",
								lastName: "Chen",
							},
						];
					}
					if (table === meetings || table === suppressions) {
						return [];
					}
					return [];
				}, selectCalls);
			}) as never);

			const result = await executeAndPersistInboundReply({
				inboundMessageId: "in_msg_1",
				organizationId: "org_1",
				threadId: "thr_1",
			});

			expect(result).toEqual({
				action: "already_processed",
				bookingCreated: false,
			});
			expect(llmCalls).toBe(0);
		} finally {
			Agent.prototype.generate = originalGenerate;
		}
	});

	test("suppressBouncedContacts normalizes email, pauses threads, and suppresses companies", async () => {
		const insertedTables: unknown[] = [];
		const updatedTables: unknown[] = [];
		const insertedValues: unknown[] = [];

		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				insert: (table: unknown) => {
					insertedTables.push(table);
					return {
						values: (vals: unknown) => {
							insertedValues.push(vals);
							return {
								onConflictDoNothing: () => Promise.resolve([]),
							};
						},
					};
				},
				update: (table: unknown) => {
					updatedTables.push(table);
					return {
						set: () => ({
							where: () => Promise.resolve([]),
						}),
					};
				},
			};
			return await callback(txMock);
		}) as never);

		await suppressBouncedContacts("email.bounced", [
			{
				companyId: "comp_1",
				email: "Founder@Brand.COM",
				id: "cont_1",
				organizationId: "org_1",
			},
		]);

		expect(insertedTables).toEqual([suppressions]);
		expect(insertedValues).toEqual([
			[
				{
					companyId: "comp_1",
					email: "founder@brand.com",
					organizationId: "org_1",
					reason: "bounce",
				},
			],
		]);
		expect(updatedTables).toEqual([threads, companies]);
	});
});

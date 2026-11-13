import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { app } from "../src/app";
import { roleAllows } from "../src/lib/auth/permissions";
import {
	SDR_INBOUND_QUEUE_NAME,
	SDR_OUTBOUND_QUEUE_NAME,
	SDR_PIPELINE_QUEUE_NAME,
	sdrInboundJobDataSchema,
	sdrOutboundJobDataSchema,
	sdrPipelineJobDataSchema,
} from "../src/lib/queues";
import {
	importCompanyUrlSchema,
	regenerateDraftSchema,
	startResearchRunSchema,
	updateCompanySchema,
} from "../src/modules/sdr/schema";
import {
	detectOptOutIntent,
	detectOutboundPriceViolation,
} from "../src/modules/sdr/service";
import {
	verifyHmacSignature,
	verifyResendWebhookSignature,
} from "../src/modules/webhooks/route";

describe("Ledgerwise SDR RBAC, queue contracts, and deterministic safety guards", () => {
	test("enforces SDR resource permissions across owner, admin, member, and viewer roles", () => {
		expect(roleAllows("owner", "lead", "research")).toBe(true);
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
			)
		).toBe(true);

		expect(
			detectOutboundPriceViolation(
				"We charge a flat monthly fee for Shopify reconciliation."
			)
		).toBe(true);

		expect(
			detectOutboundPriceViolation(
				"We tailor our scope on a 20-minute call once we see your Shopify, Amazon, and 3PL volume."
			)
		).toBe(false);
	});

	test("detects hard opt-out / unsubscribe intent deterministically (Invariant #3)", () => {
		expect(
			detectOptOutIntent("Please unsubscribe me and remove me from your list.")
		).toBe(true);
		expect(detectOptOutIntent("We are not interested, stop emailing me.")).toBe(
			true
		);
		expect(
			detectOptOutIntent(
				"2:00 PM Central works well for me, let's book the call."
			)
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
		const svixTimestamp = "1731500000";
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

		// Confirm webhook route is accessible without session cookies (returns 200 on ignored event instead of 401 auth error)
		const res = await app.request("/api/webhooks/calcom", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload,
		});
		expect(res.status).toBe(200);
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
			regenerateDraftSchema.safeParse({
				instruction: "Lead with Shopify POS reconciliation pain.",
			}).success
		).toBe(true);
	});
});

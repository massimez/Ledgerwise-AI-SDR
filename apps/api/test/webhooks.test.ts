import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { app } from "../src/app";
import { calcomWebhookSchema } from "../src/modules/webhooks/calcom/calcom.schema";
import { resendWebhookSchema } from "../src/modules/webhooks/resend/resend.schema";
import {
	verifyHmacSignature,
	verifyResendWebhookSignature,
} from "../src/modules/webhooks/route";

describe("M5 Cal.com & Resend Webhook Schemas, Signatures, and Validation", () => {
	test("validates Cal.com v2 booking lifecycle webhook payloads", () => {
		expect(
			calcomWebhookSchema.safeParse({
				payload: {
					endTime: "2026-11-18T19:30:00.000Z",
					meetingUrl: "https://app.cal.com/video/abc",
					startTime: "2026-11-18T19:00:00.000Z",
					status: "ACCEPTED",
					uid: "cal_uid_123",
				},
				triggerEvent: "BOOKING_CREATED",
			}).success
		).toBe(true);

		expect(
			calcomWebhookSchema.safeParse({
				payload: { uid: "cal_uid_123" },
				triggerEvent: "BOOKING_CANCELLED",
			}).success
		).toBe(true);

		expect(
			calcomWebhookSchema.safeParse({
				payload: "invalid",
				triggerEvent: "BOOKING_CREATED",
			}).success
		).toBe(false);
	});

	test("validates Resend inbound & outbound webhook payloads", () => {
		expect(
			resendWebhookSchema.safeParse({
				data: {
					email_id: "re_msg_1",
					from: "Maya Chen <maya@suncrestbotanics.demo>",
					subject: "Re: Quick question",
					text: "Option 2 works great!",
					to: ["reply@ledgerwise.demo"],
				},
				type: "email.received",
			}).success
		).toBe(true);

		expect(
			resendWebhookSchema.safeParse({
				data: {},
			}).success
		).toBe(false);
	});

	test("verifies Cal.com sha256 HMAC and Resend Svix base64 webhook signatures", () => {
		const secret = "cal_secret_demo";
		const body = JSON.stringify({
			payload: { uid: "u1" },
			triggerEvent: "BOOKING_CREATED",
		});
		const validDigest = createHmac("sha256", secret).update(body).digest("hex");

		expect(
			verifyHmacSignature({
				payload: body,
				secret,
				signatureHeader: `sha256=${validDigest}`,
			})
		).toBe(true);

		expect(
			verifyHmacSignature({
				payload: body,
				secret,
				signatureHeader: "sha256=deadbeef",
			})
		).toBe(false);

		const svixSecret = `whsec_${Buffer.from("super-secret-bytes").toString("base64")}`;
		const svixId = "msg_123";
		const svixTimestamp = Math.floor(Date.now() / 1000).toString();
		const signed = `${svixId}.${svixTimestamp}.${body}`;
		const svixSig = createHmac(
			"sha256",
			Buffer.from(svixSecret.slice(6), "base64")
		)
			.update(signed)
			.digest("base64");

		expect(
			verifyResendWebhookSignature({
				payload: body,
				secret: svixSecret,
				svixId,
				svixSignature: `v1,${svixSig}`,
				svixTimestamp,
			})
		).toBe(true);

		const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
		const staleSig = createHmac(
			"sha256",
			Buffer.from(svixSecret.slice(6), "base64")
		)
			.update(`${svixId}.${staleTimestamp}.${body}`)
			.digest("base64");

		expect(
			verifyResendWebhookSignature({
				payload: body,
				secret: svixSecret,
				svixId,
				svixSignature: `v1,${staleSig}`,
				svixTimestamp: staleTimestamp,
			})
		).toBe(false);

		// Empty secrets must fail closed and stale Svix headers must not fall through to xWebhookSignature
		expect(
			verifyHmacSignature({
				payload: body,
				secret: "",
				signatureHeader: undefined,
			})
		).toBe(false);
		expect(
			verifyResendWebhookSignature({
				payload: body,
				secret: "",
			})
		).toBe(false);
		const fallbackHmac = createHmac("sha256", svixSecret)
			.update(body)
			.digest("hex");
		expect(
			verifyResendWebhookSignature({
				payload: body,
				secret: svixSecret,
				svixId,
				svixSignature: `v1,${staleSig}`,
				svixTimestamp: staleTimestamp,
				xWebhookSignature: `sha256=${fallbackHmac}`,
			})
		).toBe(false);
	});

	test("returns 401 when webhook secret/signature is missing at POST /api/webhooks/calcom", async () => {
		const malformedRes = await app.request("/api/webhooks/calcom", {
			body: "{not-json",
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(malformedRes.status).toBe(401);

		const invalidRes = await app.request("/api/webhooks/calcom", {
			body: JSON.stringify({ wrong: true }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(invalidRes.status).toBe(401);
	});

	test("rejects unsafe javascript: or non-HTTP meetingUrl in Cal.com webhook payloads", () => {
		expect(
			calcomWebhookSchema.safeParse({
				payload: {
					meetingUrl: "javascript:alert(1)",
					uid: "cal_uid_xss",
				},
				triggerEvent: "BOOKING_CREATED",
			}).success
		).toBe(false);

		expect(
			calcomWebhookSchema.safeParse({
				payload: {
					meetingUrl: "https://cal.com/video/safe-room",
					uid: "cal_uid_ok",
				},
				triggerEvent: "BOOKING_CREATED",
			}).success
		).toBe(true);
	});
});

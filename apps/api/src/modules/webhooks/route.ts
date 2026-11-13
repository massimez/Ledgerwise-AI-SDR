import { Hono } from "hono";
import { env } from "../../env";
import { logWarning } from "../../lib/logger";
import { calcomWebhookSchema } from "./calcom/calcom.schema";
import { processCalcomWebhookEvent } from "./calcom/calcom.service";
import { resendWebhookSchema } from "./resend/resend.schema";
import { processResendWebhookEvent } from "./resend/resend.service";
import {
	verifyHmacSignature,
	verifyResendWebhookSignature,
} from "./shared/signatures";

function parseJsonSafe(
	rawBody: string
): { ok: true; data: unknown } | { ok: false } {
	try {
		return { data: JSON.parse(rawBody), ok: true };
	} catch {
		return { ok: false };
	}
}

export {
	verifyHmacSignature,
	verifyResendWebhookSignature,
} from "./shared/signatures";

export const webhookRoutes = new Hono()
	.post("/resend", async (c) => {
		const rawBody = await c.req.text();
		const validSignature = verifyResendWebhookSignature({
			payload: rawBody,
			secret: env.RESEND_WEBHOOK_SECRET,
			svixId: c.req.header("svix-id"),
			svixSignature: c.req.header("svix-signature"),
			svixTimestamp: c.req.header("svix-timestamp"),
			xWebhookSignature: c.req.header("x-webhook-signature"),
		});

		if (!validSignature) {
			logWarning("Webhooks:Resend", "Rejected invalid webhook signature");
			return c.json({ error: "Invalid webhook signature" }, 401);
		}

		const jsonResult = parseJsonSafe(rawBody);
		if (!jsonResult.ok) {
			return c.json({ error: "Malformed JSON payload" }, 400);
		}

		const parsed = resendWebhookSchema.safeParse(jsonResult.data);
		if (!parsed.success) {
			return c.json({ error: "Invalid Resend payload" }, 400);
		}

		const result = await processResendWebhookEvent(
			parsed.data.type,
			parsed.data.data
		);
		return c.json(result);
	})
	.post("/calcom", async (c) => {
		const rawBody = await c.req.text();
		const validSignature = verifyHmacSignature({
			payload: rawBody,
			secret: env.CALCOM_WEBHOOK_SECRET,
			signatureHeader:
				c.req.header("x-cal-signature-256") ?? c.req.header("x-cal-signature"),
		});

		if (!validSignature) {
			logWarning("Webhooks:Calcom", "Rejected invalid webhook signature");
			return c.json({ error: "Invalid Cal.com signature" }, 401);
		}

		const jsonResult = parseJsonSafe(rawBody);
		if (!jsonResult.ok) {
			return c.json({ error: "Malformed JSON payload" }, 400);
		}

		const parsed = calcomWebhookSchema.safeParse(jsonResult.data);
		if (!parsed.success) {
			return c.json({ error: "Invalid Cal.com payload" }, 400);
		}

		const result = await processCalcomWebhookEvent(
			parsed.data.triggerEvent,
			parsed.data.payload
		);
		return c.json(result);
	});

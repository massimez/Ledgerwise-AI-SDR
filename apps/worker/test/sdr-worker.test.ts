import { describe, expect, it } from "bun:test";
import { parseWorkerEnv } from "../src/env";
import { resolveOutboundDeliveryTarget } from "../src/processors/sdr/outbound";

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
		expect(env.SDR_MODEL_FAST).toBe("openrouter/google/gemini-2.5-flash");
		expect(env.SDR_MODEL_SMART).toBe("openrouter/anthropic/claude-sonnet-4.5");
		expect(env.INBOUND_EMAIL_DOMAIN).toBe("inbox.ledgerwise.demo");
	});
});

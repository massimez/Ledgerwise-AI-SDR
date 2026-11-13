export interface OutboundDeliveryTarget {
	allowSimulator: boolean;
	redirectedToSandbox: boolean;
	subject: string;
	toEmail: string;
}

/**
 * Resolve outbound recipient and subject based on `OUTBOUND_MODE=sandbox|live`.
 * In sandbox mode, email is redirected to `SANDBOX_RECIPIENT_EMAIL` (if configured)
 * or simulated locally without ever emailing a real external prospect.
 */
export function resolveOutboundDeliveryTarget(options: {
	originalRecipientEmail: string;
	outboundMode: "sandbox" | "live";
	sandboxRecipientEmail: string;
	subject: string;
}): OutboundDeliveryTarget {
	if (options.outboundMode === "live") {
		return {
			allowSimulator: false,
			redirectedToSandbox: false,
			subject: options.subject,
			toEmail: options.originalRecipientEmail,
		};
	}

	const sandboxEmail = options.sandboxRecipientEmail.trim();
	if (sandboxEmail.length > 0) {
		return {
			allowSimulator: true,
			redirectedToSandbox: true,
			subject: `[SANDBOX -> ${options.originalRecipientEmail}] ${options.subject}`,
			toEmail: sandboxEmail,
		};
	}

	return {
		allowSimulator: true,
		redirectedToSandbox: true,
		subject: `[SANDBOX SIM] ${options.subject}`,
		toEmail: options.originalRecipientEmail,
	};
}

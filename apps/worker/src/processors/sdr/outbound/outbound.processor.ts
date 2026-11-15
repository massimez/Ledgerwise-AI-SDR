import { detectOutboundPriceViolation } from "@workspace/ai-core";
import {
	type SdrOutboundJobData,
	sdrOutboundJobDataSchema,
} from "@workspace/api/queues";
import {
	findSuppressedEmail,
	getDailySendCapStatus,
} from "@workspace/api/sdr-shared";
import { type Job, UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { sendEmail } from "../../../lib/email-sender";
import { logInfo, logWarning } from "../../../lib/logger";
import { resolveOutboundDeliveryTarget } from "./delivery-target";
import {
	holdMessageForDailyCap,
	loadOutboundDeliveryContext,
	markOutboundDelivered,
	markOutboundMessageFailed,
	recordSendGateBlock,
} from "./outbound.repository";

async function sendEmailWithTerminalFallback(params: {
	headers: Record<string, string>;
	html: string;
	isFinalAttempt: boolean;
	message: { bodyText: string; id: string };
	organizationId: string;
	replyTo: string;
	target: { allowSimulator: boolean; subject: string; toEmail: string };
	threadId: string;
}) {
	try {
		return await sendEmail({
			allowSimulator: params.target.allowSimulator,
			headers: params.headers,
			html: params.html,
			idempotencyKey: `sdr-msg-${params.message.id}`,
			redactBodyInLogs: true,
			replyTo: params.replyTo,
			subject: params.target.subject,
			text: params.message.bodyText,
			to: params.target.toEmail,
		});
	} catch (error) {
		if (error instanceof UnrecoverableError || params.isFinalAttempt) {
			const errMsg =
				error instanceof Error
					? error.message
					: "Outbound email delivery failed";
			await recordSendGateBlock({
				handoffReason: `Outbound email delivery failed: ${errMsg}`,
				messageId: params.message.id,
				organizationId: params.organizationId,
				rejectReason: errMsg,
				threadId: params.threadId,
				threadStatus: "needs_human",
			}).catch((fallbackError) => {
				logWarning(
					"SdrOutbound",
					"Failed to persist outbound send-gate failure",
					{
						error:
							fallbackError instanceof Error
								? fallbackError.message
								: String(fallbackError),
						messageId: params.message.id,
						threadId: params.threadId,
					}
				);
			});
		}
		throw error;
	}
}

/** Process an outbound SDR email job with mandatory suppression & price send-gates. */
export async function processSdrOutboundJob(
	job: Job<SdrOutboundJobData>
): Promise<{
	blockedReason?: string;
	delivered: boolean;
	providerMessageId?: string;
	simulated?: boolean;
}> {
	const parsed = sdrOutboundJobDataSchema.safeParse(job.data);
	if (!parsed.success) {
		throw new UnrecoverableError(
			`Invalid outbound SDR job payload: ${parsed.error.message}`
		);
	}

	const { messageId, organizationId, threadId } = parsed.data;
	const { contact, message, thread } = await loadOutboundDeliveryContext(
		messageId,
		organizationId,
		threadId
	);

	if (!message) {
		throw new UnrecoverableError(`Outbound message ${messageId} not found.`);
	}
	if (message.status === "sent") {
		return {
			delivered: true,
			providerMessageId: message.providerMessageId ?? undefined,
		};
	}
	if (message.status !== "approved" && message.status !== "queued") {
		throw new UnrecoverableError(
			`Outbound message ${messageId} is in non-sendable status "${message.status}".`
		);
	}
	if (!thread) {
		throw new UnrecoverableError(`Thread ${threadId} not found.`);
	}

	const recipientEmail = contact?.email?.trim().toLowerCase() ?? "";
	if (!recipientEmail) {
		await markOutboundMessageFailed(
			organizationId,
			message.id,
			"Missing recipient contact email."
		);
		throw new UnrecoverableError(
			`Missing recipient email for thread ${threadId}.`
		);
	}

	const suppressed = await findSuppressedEmail(organizationId, recipientEmail);
	if (suppressed || thread.status === "opted_out") {
		await recordSendGateBlock({
			messageId: message.id,
			organizationId,
			rejectReason: `Blocked by suppression send-gate (${suppressed?.reason ?? "opted_out"}).`,
			threadId: thread.id,
			threadStatus: "opted_out",
		});
		logWarning("SdrOutbound", "Blocked outbound send due to suppression list", {
			messageId: message.id,
			threadId: thread.id,
		});
		return { blockedReason: "suppressed", delivered: false };
	}

	const capStatus = await getDailySendCapStatus(organizationId, {
		excludeMessageId: message.id,
	});
	if (capStatus.reached) {
		await holdMessageForDailyCap({
			cap: capStatus.cap,
			messageId: message.id,
			organizationId,
			threadId: thread.id,
		});
		logWarning("SdrOutbound", "Held outbound message due to daily send cap", {
			cap: capStatus.cap,
			messageId: message.id,
			threadId: thread.id,
			used: capStatus.used,
		});
		return { blockedReason: "daily_send_cap", delivered: false };
	}

	const citedSpans = (message.citations ?? []).map((citation) => citation.span);
	const priceViolation = detectOutboundPriceViolation(
		`${message.subject}\n${message.bodyText}`,
		citedSpans
	);
	if (priceViolation !== null) {
		await recordSendGateBlock({
			handoffReason: `Outbound price guard blocked "${priceViolation}"`,
			messageId: message.id,
			organizationId,
			rejectReason: `Blocked by price send-gate: "${priceViolation}"`,
			threadId: thread.id,
			threadStatus: "needs_human",
		});
		return { blockedReason: "price_violation", delivered: false };
	}

	const target = resolveOutboundDeliveryTarget({
		originalRecipientEmail: recipientEmail,
		outboundMode: env.OUTBOUND_MODE,
		sandboxRecipientEmail: env.SANDBOX_RECIPIENT_EMAIL,
		subject: message.subject,
	});

	const replyTo = `reply+${thread.replyToken}@${env.INBOUND_EMAIL_DOMAIN}`;
	const headers: Record<string, string> = {
		"X-Ledgerwise-Outbound-Mode": env.OUTBOUND_MODE,
		"X-Ledgerwise-Thread-Id": thread.id,
		...(target.redirectedToSandbox
			? { "X-Ledgerwise-Original-To": recipientEmail }
			: {}),
		...(message.inReplyTo
			? {
					"In-Reply-To": message.inReplyTo,
					References: message.inReplyTo,
				}
			: {}),
	};

	const escapedHtml = message.bodyText
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\n", "<br />");

	const maxAttempts = job.opts.attempts ?? 1;
	const sendResult = await sendEmailWithTerminalFallback({
		headers,
		html: `<div>${escapedHtml}</div>`,
		isFinalAttempt: job.attemptsMade + 1 >= maxAttempts,
		message,
		organizationId,
		replyTo,
		target,
		threadId: thread.id,
	});

	await markOutboundDelivered({
		companyId: thread.companyId,
		currentThreadStatus: thread.status,
		incrementAiReply: message.author === "ai",
		messageId: message.id,
		organizationId,
		providerMessageId: sendResult.messageId,
		threadId: thread.id,
	});

	logInfo("SdrOutbound", "Delivered SDR outbound message", {
		messageId: message.id,
		mode: env.OUTBOUND_MODE,
		simulated: sendResult.simulated,
		threadId: thread.id,
	});

	return {
		delivered: true,
		providerMessageId: sendResult.messageId,
		simulated: sendResult.simulated,
	};
}

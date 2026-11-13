import { detectOutboundPriceViolation } from "@workspace/ai-core";
import {
	type SdrOutboundJobData,
	sdrOutboundJobDataSchema,
} from "@workspace/api/queues";
import { type Job, UnrecoverableError } from "bullmq";
import { env } from "../../../env";
import { sendEmail } from "../../../lib/email-sender";
import { logInfo, logWarning } from "../../../lib/logger";
import { resolveOutboundDeliveryTarget } from "./delivery-target";
import {
	findOutboundSuppression,
	loadOutboundDeliveryContext,
	markOutboundDelivered,
	markOutboundMessageFailed,
	recordSendGateBlock,
} from "./outbound.repository";

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
	if (!thread) {
		throw new UnrecoverableError(`Thread ${threadId} not found.`);
	}

	const recipientEmail = contact?.email?.trim().toLowerCase() ?? "";
	if (!recipientEmail) {
		await markOutboundMessageFailed(
			message.id,
			"Missing recipient contact email."
		);
		throw new UnrecoverableError(
			`Missing recipient email for thread ${threadId}.`
		);
	}

	const suppressed = await findOutboundSuppression(
		organizationId,
		recipientEmail
	);
	if (suppressed || thread.status === "opted_out") {
		await recordSendGateBlock({
			messageId: message.id,
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

	const citedSpans = (message.citations ?? []).map((citation) => citation.span);
	const priceViolation = detectOutboundPriceViolation(
		`${message.subject}\n${message.bodyText}`,
		citedSpans
	);
	if (priceViolation !== null) {
		await recordSendGateBlock({
			handoffReason: `Outbound price guard blocked "${priceViolation}"`,
			messageId: message.id,
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

	const sendResult = await sendEmail({
		allowSimulator: target.allowSimulator,
		headers,
		html: `<div>${escapedHtml}</div>`,
		idempotencyKey: `sdr-msg-${message.id}`,
		redactBodyInLogs: true,
		replyTo,
		subject: target.subject,
		text: message.bodyText,
		to: target.toEmail,
	});

	await markOutboundDelivered({
		companyId: thread.companyId,
		currentAiReplyCount: thread.aiReplyCount,
		currentThreadStatus: thread.status,
		incrementAiReply: message.author === "ai",
		messageId: message.id,
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

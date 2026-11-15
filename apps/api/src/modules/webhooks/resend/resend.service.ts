import { logInfo } from "../../../lib/logger";
import { enqueueSdrInboundJob } from "../../sdr/queue";
import {
	findContactsByEmails,
	findMessageByProviderId,
	findThreadByInReplyTo,
	findThreadByReplyToken,
	insertInboundWebhookMessage,
	markThreadInboundQueued,
	suppressBouncedContacts,
} from "./resend.repository";
import {
	extractReplyToken,
	normalizeAddressList,
	type ResendWebhookData,
} from "./resend.schema";

async function findTargetThread(data: ResendWebhookData) {
	const token = extractReplyToken(data.to);
	if (token) {
		const byToken = await findThreadByReplyToken(token);
		if (byToken) {
			return byToken;
		}
	}

	const inReplyTo = data.in_reply_to ?? data.headers?.["in-reply-to"];
	if (!inReplyTo) {
		return null;
	}

	return await findThreadByInReplyTo(inReplyTo);
}

async function handleResendBounce(
	eventType: string,
	toField: string | string[] | undefined
) {
	const emails = normalizeAddressList(toField).map((addr) =>
		addr.trim().toLowerCase()
	);
	if (emails.length === 0) {
		return;
	}

	const matchedContacts = await findContactsByEmails(emails);
	if (matchedContacts.length === 0) {
		return;
	}

	await suppressBouncedContacts(eventType, matchedContacts);
}

async function queueInboundMessageJob(params: {
	messageId: string;
	organizationId: string;
	threadId: string;
}) {
	const job = await enqueueSdrInboundJob({
		inboundMessageId: params.messageId,
		organizationId: params.organizationId,
		source: "webhook",
		threadId: params.threadId,
	});

	await markThreadInboundQueued(
		params.threadId,
		job.id ? String(job.id) : params.messageId
	);
}

async function handleResendInbound(data: ResendWebhookData) {
	const thread = await findTargetThread(data);
	if (!thread) {
		return { unmatched: true };
	}

	let existing = data.email_id
		? await findMessageByProviderId(data.email_id)
		: null;

	if (!existing) {
		const bodyText = (data.text ?? data.html ?? "").trim();
		const inReplyTo = data.in_reply_to ?? data.headers?.["in-reply-to"] ?? null;
		const inserted = await insertInboundWebhookMessage({
			bodyText: bodyText.length > 0 ? bodyText : "(empty email body)",
			inReplyTo,
			organizationId: thread.organizationId,
			providerMessageId: data.email_id ?? null,
			subject: data.subject ?? "Re: Ledgerwise",
			threadId: thread.id,
		});

		if (inserted) {
			await queueInboundMessageJob({
				messageId: inserted.id,
				organizationId: thread.organizationId,
				threadId: thread.id,
			});

			logInfo("Webhooks:Resend", "Queued inbound reply job", {
				messageId: inserted.id,
				threadId: thread.id,
			});

			return { messageId: inserted.id };
		}

		if (data.email_id) {
			existing = await findMessageByProviderId(data.email_id);
		}
	}

	if (!existing) {
		return {};
	}

	// Recover dropped/unprocessed webhook deliveries on provider retry
	if (
		existing.classification === null &&
		!thread.pendingJobId &&
		thread.status !== "opted_out"
	) {
		await queueInboundMessageJob({
			messageId: existing.id,
			organizationId: thread.organizationId,
			threadId: thread.id,
		});

		logInfo("Webhooks:Resend", "Re-queued unclassified inbound reply job", {
			messageId: existing.id,
			threadId: thread.id,
		});

		return { messageId: existing.id, retried: true };
	}

	return { deduplicated: true };
}

/** Dispatch validated Resend webhook events for bounces, complaints, and inbound replies. */
export async function processResendWebhookEvent(
	type: string,
	data: ResendWebhookData
) {
	if (type === "email.bounced" || type === "email.complained") {
		await handleResendBounce(type, data.to);
		return { handled: type, received: true };
	}

	if (type !== "email.received") {
		return { ignored: type, received: true };
	}

	const outcome = await handleResendInbound(data);
	return { received: true, ...outcome };
}

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

async function handleResendInbound(data: ResendWebhookData) {
	const thread = await findTargetThread(data);
	if (!thread) {
		return { unmatched: true };
	}

	if (data.email_id) {
		const duplicate = await findMessageByProviderId(data.email_id);
		if (duplicate) {
			return { deduplicated: true };
		}
	}

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

	if (!inserted) {
		return {};
	}

	const job = await enqueueSdrInboundJob({
		inboundMessageId: inserted.id,
		organizationId: thread.organizationId,
		source: "webhook",
		threadId: thread.id,
	});

	await markThreadInboundQueued(
		thread.id,
		job.id ? String(job.id) : inserted.id
	);

	logInfo("Webhooks:Resend", "Queued inbound reply job", {
		messageId: inserted.id,
		threadId: thread.id,
	});

	return { messageId: inserted.id };
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

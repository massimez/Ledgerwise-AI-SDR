import { detectOutboundPriceViolation } from "@workspace/ai-core";
import { env } from "../../../env";
import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { logWarning } from "../../../lib/logger";
import { enqueueSdrOutboundJob, enqueueSdrPipelineJob } from "../queue";
import {
	findContactSuppression,
	findThreadById,
	getDailySendCapStatus,
	markMessageSentFallback,
	revertApprovedDraftAfterQueueFailure,
} from "../shared/sdr.repository";
import {
	findMessageById,
	findReviewQueueDataset,
	markDraftApproved,
	markDraftRejected,
	setThreadPendingJob,
} from "./review.repository";

/** Return all pending outreach drafts enriched with company, contact, criteria, and verified evidence. */
export async function getReviewQueue(organizationId: string) {
	const dataset = await findReviewQueueDataset(organizationId);
	if (!dataset) {
		return [];
	}

	const threadMap = new Map(dataset.allThreads.map((t) => [t.id, t]));
	const companyMap = new Map(dataset.allCompanies.map((c) => [c.id, c]));
	const contactMap = new Map(dataset.allContacts.map((c) => [c.id, c]));

	return dataset.pendingMessages
		.map((msg) => {
			const thread = threadMap.get(msg.threadId);
			if (!thread) {
				return null;
			}
			const company = companyMap.get(thread.companyId);
			if (!company) {
				return null;
			}
			const contact = thread.contactId
				? (contactMap.get(thread.contactId) ?? null)
				: null;
			const criteria = dataset.allCriteria.filter(
				(cr) => cr.companyId === company.id
			);
			const companyEvidence = dataset.allEvidence.filter(
				(ev) => ev.companyId === company.id && ev.verified
			);

			return {
				company,
				contact,
				criteria,
				evidence: companyEvidence,
				message: msg,
				thread,
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null);
}

/** Validate guards, approve an outreach draft, and enqueue worker delivery. */
export async function approveReviewMessage(params: {
	bodyText?: string;
	messageId: string;
	organizationId: string;
	subject?: string;
	userId: string;
}) {
	const msg = await findMessageById(params.organizationId, params.messageId);
	if (!msg) {
		throw new NotFoundError("Draft message");
	}
	if (msg.status !== "pending_review") {
		throw new ConflictError(
			`Draft message cannot be approved from status "${msg.status}".`
		);
	}

	const finalBody = params.bodyText?.trim() || msg.bodyText;
	const finalSubject = params.subject?.trim() || msg.subject;
	const citedSpans = (msg.citations ?? []).map((c) => c.span);

	if (
		detectOutboundPriceViolation(`${finalSubject}\n${finalBody}`, citedSpans)
	) {
		throw new ValidationError(
			"Ledgerwise policy violation: outbound email must never quote a dollar price or monthly fee. Pricing is discussed on a call.",
			"bodyText"
		);
	}

	const thread = await findThreadById(params.organizationId, msg.threadId);
	if (!thread) {
		throw new NotFoundError("Thread");
	}

	if (thread.contactId) {
		const suppression = await findContactSuppression(
			params.organizationId,
			thread.contactId
		);
		if (suppression) {
			throw new ConflictError(
				`Cannot send email: ${suppression.email} is on the suppression list (${suppression.reason}).`
			);
		}
	}

	const capStatus = await getDailySendCapStatus(params.organizationId, {
		excludeMessageId: msg.id,
	});
	if (capStatus.reached) {
		throw new ValidationError(
			`Daily send cap (${capStatus.cap}) reached for today. Increase the cap in Playbook Settings or try again tomorrow.`
		);
	}

	const now = new Date();
	const approved = await markDraftApproved({
		bodyText: finalBody,
		companyId: thread.companyId,
		decisionSummary:
			finalBody === msg.bodyText
				? "Approved by sales team and queued for delivery."
				: "Edited and approved by sales team; passed price & suppression guards.",
		messageId: msg.id,
		now,
		organizationId: params.organizationId,
		subject: finalSubject,
		threadId: thread.id,
		userId: params.userId,
	});
	if (!approved) {
		throw new ConflictError(
			"Draft message could not be approved because its status changed."
		);
	}

	try {
		await enqueueSdrOutboundJob({
			messageId: msg.id,
			organizationId: params.organizationId,
			threadId: thread.id,
		});
	} catch (error) {
		if (env.NODE_ENV === "production") {
			await revertApprovedDraftAfterQueueFailure({
				companyId: thread.companyId,
				messageId: msg.id,
				organizationId: params.organizationId,
				previousBodyText: msg.bodyText,
				previousCompanyStatus: approved.previousCompanyStatus,
				previousDecisionSummary: msg.decisionSummary,
				previousLastMessageAt: thread.lastMessageAt,
				previousSubject: msg.subject,
				previousThreadStatus: thread.status,
				threadId: thread.id,
			}).catch((rollbackError) => {
				logWarning(
					"SDRReviewService:approveReviewMessage",
					"Failed to revert approved draft after queue error",
					{ error: String(rollbackError), messageId: msg.id }
				);
			});
			throw error;
		}
		logWarning(
			"SDRReviewService:approveReviewMessage",
			"Redis queue unavailable in dev; message marked sent in sandbox mode",
			{ error: String(error), messageId: msg.id }
		);
		const fallbackMsg = await markMessageSentFallback(msg.id, now);
		return fallbackMsg ?? approved.updatedMessage;
	}

	return approved.updatedMessage;
}

/** Reject a pending outreach draft with a human reason and close its thread. */
export async function rejectReviewMessage(params: {
	messageId: string;
	organizationId: string;
	reason: string;
	userId: string;
}) {
	const msg = await findMessageById(params.organizationId, params.messageId);
	if (!msg) {
		throw new NotFoundError("Draft message");
	}
	if (msg.status !== "pending_review") {
		throw new ConflictError(
			`Draft message cannot be rejected from status "${msg.status}".`
		);
	}

	const rejected = await markDraftRejected({
		messageId: msg.id,
		organizationId: params.organizationId,
		reason: params.reason,
		threadId: msg.threadId,
	});
	if (!rejected) {
		throw new ConflictError(
			"Draft message could not be rejected because its status changed."
		);
	}
	return rejected;
}

/** Enqueue regeneration of a pending outreach draft with optional human instruction. */
export async function regenerateReviewDraft(params: {
	instruction?: string;
	messageId: string;
	organizationId: string;
	userId: string;
}) {
	const msg = await findMessageById(params.organizationId, params.messageId);
	if (!msg) {
		throw new NotFoundError("Draft message");
	}
	if (msg.status !== "pending_review") {
		throw new ConflictError(
			`Draft message cannot be regenerated from status "${msg.status}".`
		);
	}

	const thread = await findThreadById(params.organizationId, msg.threadId);
	if (!thread) {
		throw new NotFoundError("Thread");
	}

	const pendingJobId = `regen_${msg.id.slice(0, 8)}_${Date.now()}`;
	await setThreadPendingJob(params.organizationId, thread.id, pendingJobId);

	let queued = false;
	try {
		await enqueueSdrPipelineJob({
			action: "regenerate-draft",
			companyId: thread.companyId,
			instruction: params.instruction,
			messageId: msg.id,
			organizationId: params.organizationId,
			requestedByUserId: params.userId,
		});
		queued = true;
	} catch (error) {
		await setThreadPendingJob(params.organizationId, thread.id, null).catch(
			(clearError) => {
				logWarning(
					"SDRReviewService:regenerateReviewDraft",
					"Failed to clear pendingJobId after queue error",
					{ error: String(clearError), messageId: msg.id, threadId: thread.id }
				);
			}
		);
		if (env.NODE_ENV === "production") {
			throw error;
		}
		logWarning(
			"SDRReviewService:regenerateReviewDraft",
			"Redis queue unavailable; regenerate draft request recorded without worker",
			{ error: String(error), messageId: msg.id }
		);
	}

	return {
		messageId: msg.id,
		pendingJobId,
		queued,
		threadId: thread.id,
	};
}

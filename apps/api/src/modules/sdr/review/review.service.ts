import {
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../../lib/errors";
import { logWarning } from "../../../lib/logger";
import { enqueueSdrOutboundJob, enqueueSdrPipelineJob } from "../queue";
import { detectOutboundPriceViolation } from "../shared/guards";
import {
	findContactSuppression,
	findMessageById,
	findReviewQueueDataset,
	findThreadById,
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

/** Validate guards, approve an outreach draft, mark it sent, and enqueue worker delivery. */
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

	const finalBody = params.bodyText?.trim() || msg.bodyText;
	const finalSubject = params.subject?.trim() || msg.subject;
	const citedSpans = (msg.citations ?? []).map((c) => c.span);

	if (detectOutboundPriceViolation(finalBody, citedSpans)) {
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

	const updatedMessage = await markDraftApproved({
		bodyText: finalBody,
		companyId: thread.companyId,
		decisionSummary:
			finalBody === msg.bodyText
				? "Approved by sales team and dispatched via sandbox send gate."
				: "Edited and approved by sales team; passed price & suppression guards.",
		messageId: msg.id,
		now: new Date(),
		subject: finalSubject,
		threadId: thread.id,
		userId: params.userId,
	});

	try {
		await enqueueSdrOutboundJob({
			messageId: msg.id,
			organizationId: params.organizationId,
			threadId: thread.id,
		});
	} catch (error) {
		logWarning(
			"SDRReviewService:approveReviewMessage",
			"Redis queue unavailable in dev; message marked sent in sandbox mode",
			{ error: String(error), messageId: msg.id }
		);
	}

	return updatedMessage;
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

	return await markDraftRejected({
		messageId: msg.id,
		reason: params.reason,
		threadId: msg.threadId,
	});
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

	const thread = await findThreadById(params.organizationId, msg.threadId);
	if (!thread) {
		throw new NotFoundError("Thread");
	}

	const pendingJobId = `regen_${msg.id.slice(0, 8)}_${Date.now()}`;
	await setThreadPendingJob(thread.id, pendingJobId);

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

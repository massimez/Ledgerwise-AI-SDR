import type { InboundReplyPipelineOutput } from "@workspace/ai-core";
import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	contacts,
	meetings,
	messages,
	type OfferedSlot,
	type ReplyClassificationReport,
	sdrSettings,
	suppressions,
	threads,
} from "@workspace/db/schema/sdr";
import { and, eq } from "drizzle-orm";

/** Load inbound message, thread, company, contact, and SDR settings for a worker job. */
export async function loadInboundJobRecords(
	inboundMessageId: string,
	organizationId: string,
	threadId: string
) {
	const [[inboundMsg], [thread]] = await Promise.all([
		db
			.select()
			.from(messages)
			.where(
				and(
					eq(messages.id, inboundMessageId),
					eq(messages.organizationId, organizationId)
				)
			)
			.limit(1),
		db
			.select()
			.from(threads)
			.where(
				and(
					eq(threads.id, threadId),
					eq(threads.organizationId, organizationId)
				)
			)
			.limit(1),
	]);

	if (!(inboundMsg && thread)) {
		return {
			company: undefined,
			contact: undefined,
			inboundMsg,
			settings: undefined,
			thread,
		};
	}

	const [[company], [settings], contactRows] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(eq(companies.id, thread.companyId))
			.limit(1),
		db
			.select()
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
		thread.contactId
			? db
					.select()
					.from(contacts)
					.where(eq(contacts.id, thread.contactId))
					.limit(1)
			: Promise.resolve([]),
	]);

	return {
		company,
		contact: contactRows[0],
		inboundMsg,
		settings,
		thread,
	};
}

/** Save classification JSON onto an inbound message row. */
export async function saveInboundClassification(
	inboundMessageId: string,
	classification: ReplyClassificationReport
) {
	await db
		.update(messages)
		.set({ classification })
		.where(eq(messages.id, inboundMessageId));
}

/** Persist LLM/fallback telemetry rows for an inbound reply run. */
export async function saveInboundAgentRuns(params: {
	companyId: string;
	inboundMessageId: string;
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	threadId: string;
}) {
	if (params.pipelineResult.telemetry.length === 0) {
		return;
	}

	await db.insert(agentRuns).values(
		params.pipelineResult.telemetry.map((run) => ({
			companyId: params.companyId,
			decision: params.pipelineResult.action,
			guardResults: params.pipelineResult.guardResult,
			inputTokens: run.tokensIn,
			latencyMs: run.latencyMs,
			messageId: params.inboundMessageId,
			model: run.model,
			organizationId: params.organizationId,
			output: { summary: run.outputSummary },
			outputTokens: run.tokensOut,
			step: (run.agentName === "reply_classifier" ? "classify" : "reply") as
				| "classify"
				| "reply",
			threadId: params.threadId,
		}))
	);
}

/** Record permanent opt-out suppression and mark thread + company suppressed. */
export async function persistOptOutDecision(params: {
	companyDomain: string | null;
	companyId: string;
	contactEmail: string | null;
	inboundMessageId: string;
	organizationId: string;
	threadId: string;
}) {
	if (params.contactEmail) {
		await db
			.insert(suppressions)
			.values({
				companyId: params.companyId,
				domain: params.companyDomain,
				email: params.contactEmail.toLowerCase(),
				organizationId: params.organizationId,
				reason: "opt_out",
				sourceMessageId: params.inboundMessageId,
			})
			.onConflictDoNothing();
	}

	await Promise.all([
		db
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: "Prospect opted out; address added to suppression list.",
				pendingJobId: null,
				status: "opted_out",
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({ status: "suppressed" })
			.where(eq(companies.id, params.companyId)),
	]);
}

/** Pause AI auto-replies after an out-of-office autoresponder. */
export async function persistOooPauseDecision(threadId: string) {
	await db
		.update(threads)
		.set({
			aiMode: "paused",
			handoffReason: "Out-of-office reply detected.",
			pendingJobId: null,
			status: "active",
		})
		.where(eq(threads.id, threadId));
}

/** Escalate a thread to human review and pause AI auto-replies. */
export async function persistEscalationDecision(params: {
	companyId: string;
	reason: string;
	threadId: string;
}) {
	await Promise.all([
		db
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: params.reason,
				pendingJobId: null,
				status: "needs_human",
			})
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({ status: "replied" })
			.where(eq(companies.id, params.companyId)),
	]);
}

/** Persist a confirmed meeting row when the inbound pipeline booked a slot. */
export async function persistConfirmedBooking(params: {
	calBookingUid: string;
	companyId: string;
	companyName: string;
	contactEmail: string;
	contactId: string | null;
	endTimeIso: string;
	meetingUrl: string;
	organizationId: string;
	prospectTimezone: string;
	simulated: boolean;
	startTimeIso: string;
	threadId: string;
}) {
	await db
		.insert(meetings)
		.values({
			attendeeEmail: params.contactEmail,
			calBookingUid: params.calBookingUid,
			companyId: params.companyId,
			contactId: params.contactId,
			endAt: new Date(params.endTimeIso),
			meetingUrl: params.meetingUrl,
			notes: `Booked autonomously via SDR reply flow (${params.simulated ? "sandbox" : "cal.com"}).`,
			organizationId: params.organizationId,
			startAt: new Date(params.startTimeIso),
			status: "scheduled",
			threadId: params.threadId,
			timezone: params.prospectTimezone,
			title: `Ledgerwise Discovery — ${params.companyName}`,
		})
		.onConflictDoNothing();

	await Promise.all([
		db
			.update(threads)
			.set({ aiMode: "paused", status: "booked" })
			.where(eq(threads.id, params.threadId)),
		db
			.update(companies)
			.set({ status: "meeting_booked" })
			.where(eq(companies.id, params.companyId)),
	]);
}

/** Insert queued/pending_review outbound reply and update thread slots/status. */
export async function persistReplyDraft(params: {
	body: string;
	bookingCreated: boolean;
	inboundProviderMessageId: string | null;
	isAutoSend: boolean;
	offeredSlots: OfferedSlot[];
	organizationId: string;
	rationale: string;
	subject: string;
	threadId: string;
}) {
	const [createdReply] = await db
		.insert(messages)
		.values({
			aiOriginalBody: params.body,
			author: "ai",
			bodyText: params.body,
			citations: [],
			decisionSummary: params.rationale,
			direction: "outbound",
			inReplyTo: params.inboundProviderMessageId,
			organizationId: params.organizationId,
			status: params.isAutoSend ? "queued" : "pending_review",
			subject: params.subject,
			threadId: params.threadId,
		})
		.returning({ id: messages.id });

	let nextStatus: "booked" | "active" | "awaiting_review" = "awaiting_review";
	if (params.bookingCreated) {
		nextStatus = "booked";
	} else if (params.isAutoSend) {
		nextStatus = "active";
	}

	await db
		.update(threads)
		.set({
			offeredSlots: params.offeredSlots,
			pendingJobId: null,
			status: nextStatus,
		})
		.where(eq(threads.id, params.threadId));

	return createdReply?.id;
}

/** Clear thread pendingJobId when an inbound pipeline produced no outbound draft. */
export async function clearThreadPendingInboundJob(threadId: string) {
	await db
		.update(threads)
		.set({ pendingJobId: null })
		.where(eq(threads.id, threadId));
}

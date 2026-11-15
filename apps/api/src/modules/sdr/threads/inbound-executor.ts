import {
	DEFAULT_SDR_MODEL_FAST,
	DEFAULT_SDR_MODEL_SMART,
	type InboundReplyPipelineOutput,
	runInboundReplyPipeline,
} from "@workspace/ai-core";
import { db } from "@workspace/db";
import {
	agentRuns,
	companies,
	contacts,
	meetings,
	messages,
	type ReplyClassificationReport,
	sdrSettings,
	suppressions,
	type ThreadStatus,
	threads,
} from "@workspace/db/schema/sdr";
import {
	and,
	desc,
	eq,
	inArray,
	isNull,
	lt,
	notInArray,
	sql,
} from "drizzle-orm";
import { getDailySendCapStatus } from "../shared/sdr.repository";

/** Build normalized model options for worker and API inbound execution. */
export function buildSdrModelOptions(config: {
	googleApiKey?: string;
	googleGenerativeAiApiKey?: string;
	openrouterApiKey?: string;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
}) {
	return {
		googleApiKey:
			config.googleGenerativeAiApiKey || config.googleApiKey || undefined,
		openrouterApiKey: config.openrouterApiKey || undefined,
		requireLlm: true,
		sdrGeminiModel: config.sdrGeminiModel || undefined,
		sdrModelFast: config.sdrModelFast || DEFAULT_SDR_MODEL_FAST,
		sdrModelSmart: config.sdrModelSmart || DEFAULT_SDR_MODEL_SMART,
	};
}

export class InboundPrerequisiteError extends Error {
	code:
		| "inbound_not_found"
		| "thread_not_found"
		| "settings_not_found"
		| "missing_contact_email";

	constructor(code: InboundPrerequisiteError["code"], message: string) {
		super(message);
		this.name = "InboundPrerequisiteError";
		this.code = code;
	}
}

export interface InboundExecutionNotifyEvent {
	calBookingUid?: string;
	companyId: string;
	companyName: string;
	inboundMessageId: string;
	messageId?: string;
	reason?: string;
	startTimeIso?: string;
	threadId: string;
	type: "sdr_review_ready" | "sdr_meeting_booked" | "sdr_needs_human";
}

export interface ExecuteInboundReplyParams {
	calcomApiKey?: string;
	calcomEventTypeId?: number | string;
	googleApiKey?: string;
	inboundMessageId: string;
	onAutoSendReply?: (params: {
		messageId: string;
		organizationId: string;
		threadId: string;
	}) => Promise<unknown>;
	onNotify?: (event: InboundExecutionNotifyEvent) => Promise<void>;
	openrouterApiKey?: string;
	organizationId: string;
	requireLlm?: boolean;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
	threadId: string;
}

export interface ExecuteInboundReplyResult {
	action: string;
	bookingCreated: boolean;
	replyMessageId?: string;
}

/** Load inbound message, thread, company, contact, SDR settings, active booking, and suppression state. */
async function loadInboundExecutionContext(
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

	if (inboundMsg?.direction !== "inbound") {
		throw new InboundPrerequisiteError(
			"inbound_not_found",
			`Inbound message ${inboundMessageId} not found.`
		);
	}
	if (!thread || inboundMsg.threadId !== thread.id) {
		throw new InboundPrerequisiteError(
			"thread_not_found",
			`Thread ${threadId} not found.`
		);
	}

	const [
		[company],
		[settings],
		contactRows,
		[activeBooking],
		priorMessageRows,
	] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(
				and(
					eq(companies.id, thread.companyId),
					eq(companies.organizationId, organizationId)
				)
			)
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
					.where(
						and(
							eq(contacts.id, thread.contactId),
							eq(contacts.organizationId, organizationId)
						)
					)
					.limit(1)
			: Promise.resolve([]),
		db
			.select()
			.from(meetings)
			.where(
				and(
					eq(meetings.threadId, thread.id),
					eq(meetings.organizationId, organizationId),
					inArray(meetings.status, ["scheduled", "rescheduled"])
				)
			)
			.limit(1),
		db
			.select({
				bodyText: messages.bodyText,
				direction: messages.direction,
			})
			.from(messages)
			.where(
				and(
					eq(messages.threadId, thread.id),
					eq(messages.organizationId, organizationId),
					lt(messages.createdAt, inboundMsg.createdAt)
				)
			)
			.orderBy(desc(messages.createdAt))
			.limit(10),
	]);

	if (!settings) {
		throw new InboundPrerequisiteError(
			"settings_not_found",
			`SDR settings not found for organization ${organizationId}.`
		);
	}

	const [contact] = contactRows;
	const contactEmail = contact?.email?.trim().toLowerCase() ?? "";
	if (!contactEmail) {
		throw new InboundPrerequisiteError(
			"missing_contact_email",
			`Missing prospect contact email for thread ${threadId}.`
		);
	}

	const [suppressedRow] = await db
		.select({ id: suppressions.id, reason: suppressions.reason })
		.from(suppressions)
		.where(
			and(
				eq(suppressions.organizationId, organizationId),
				eq(sql`lower(${suppressions.email})`, contactEmail)
			)
		)
		.limit(1);

	return {
		activeBooking,
		company,
		contact,
		contactEmail,
		inboundMsg,
		recentMessages: priorMessageRows.reverse(),
		settings,
		suppressedRow: suppressedRow ?? null,
		thread,
	};
}

function buildAgentRunRows(params: {
	companyId: string;
	inboundMessageId: string;
	messageId?: string;
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	threadId: string;
}) {
	return params.pipelineResult.telemetry.map((run) => ({
		companyId: params.companyId,
		decision: params.pipelineResult.action,
		guardResults: params.pipelineResult.guardResult,
		inputTokens: run.tokensIn,
		latencyMs: run.latencyMs,
		messageId: params.messageId ?? params.inboundMessageId,
		model: run.model,
		organizationId: params.organizationId,
		output: { summary: run.outputSummary },
		outputTokens: run.tokensOut,
		step: (run.agentName === "reply_classifier" ? "classify" : "reply") as
			| "classify"
			| "reply",
		threadId: params.threadId,
	}));
}

function buildSuppressedClassification(
	rationale: string
): ReplyClassificationReport {
	return {
		asksIfBot: false,
		confidence: 1,
		detectedTimezone: null,
		intent: "opt_out",
		isOptOut: true,
		mentionsPricing: false,
		needsInfoFromHuman: false,
		rationale,
		selectedSlotIso: null,
		wantsMeeting: false,
	};
}

function resolveOutboundMessageStatus(
	isAutoSend: boolean,
	sendInline: boolean
): "sent" | "queued" | "pending_review" {
	if (sendInline) {
		return "sent";
	}
	return isAutoSend ? "queued" : "pending_review";
}

function resolveReplyThreadStatus(
	bookingCreated: boolean,
	isAutoSend: boolean
): ThreadStatus {
	if (bookingCreated) {
		return "booked";
	}
	return isAutoSend ? "active" : "awaiting_review";
}

function resolvePausedThreadStatus(
	currentThreadStatus: ThreadStatus,
	action: "ooo_pause" | "escalate_to_human"
): ThreadStatus {
	if (currentThreadStatus === "human") {
		return "human";
	}
	return action === "ooo_pause" ? "active" : "needs_human";
}

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function persistTerminalOutcomeInTx(
	tx: DrizzleTx,
	params: {
		action: "opt_out_halt" | "ooo_pause" | "escalate_to_human";
		companyDomain: string | null;
		companyId: string;
		contactEmail: string;
		currentThreadStatus: ThreadStatus;
		detectedTimezone?: string | null;
		escalationReason: string;
		inboundMessageId: string;
		now: Date;
		organizationId: string;
		threadId: string;
	}
) {
	const timezonePatch = params.detectedTimezone
		? { prospectTimezone: params.detectedTimezone }
		: {};

	if (params.action === "opt_out_halt") {
		await tx
			.insert(suppressions)
			.values({
				companyId: params.companyId,
				domain: params.companyDomain,
				email: params.contactEmail,
				organizationId: params.organizationId,
				reason: "opt_out",
				sourceMessageId: params.inboundMessageId,
			})
			.onConflictDoNothing();

		await tx
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: "Prospect opted out; address added to suppression list.",
				lastMessageAt: params.now,
				pendingJobId: null,
				status: "opted_out",
				...timezonePatch,
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		await tx
			.update(companies)
			.set({ status: "suppressed" })
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			);
		return;
	}

	const nextStatus = resolvePausedThreadStatus(
		params.currentThreadStatus,
		params.action
	);
	const handoffReason =
		params.action === "ooo_pause"
			? "Out-of-office reply detected."
			: params.escalationReason;

	await tx
		.update(threads)
		.set({
			aiMode: "paused",
			handoffReason,
			lastMessageAt: params.now,
			pendingJobId: null,
			status: nextStatus,
			...timezonePatch,
		})
		.where(
			and(
				eq(threads.id, params.threadId),
				eq(threads.organizationId, params.organizationId)
			)
		);

	await tx
		.update(companies)
		.set({ status: "replied" })
		.where(
			and(
				eq(companies.id, params.companyId),
				eq(companies.organizationId, params.organizationId),
				notInArray(companies.status, [
					"suppressed",
					"disqualified",
					"meeting_booked",
				])
			)
		);
}

async function persistBookingAndReplyInTx(
	tx: DrizzleTx,
	params: {
		companyId: string;
		companyName: string;
		contactEmail: string;
		contactId: string | null;
		currentAiMode: "auto" | "paused";
		inboundProviderMessageId: string | null;
		now: Date;
		organizationId: string;
		pipelineResult: InboundReplyPipelineOutput;
		prospectTimezone: string;
		shouldSendInline: boolean;
		threadId: string;
	}
): Promise<{ bookingCreated: boolean; replyMessageId?: string }> {
	let bookingCreated = false;
	const { booking, classification, offeredSlots, replyDraft } =
		params.pipelineResult;
	const nextTimezone =
		classification.detectedTimezone &&
		classification.detectedTimezone !== params.prospectTimezone
			? classification.detectedTimezone
			: undefined;

	if (booking) {
		const [insertedMeeting] = await tx
			.insert(meetings)
			.values({
				attendeeEmail: params.contactEmail,
				calBookingUid: booking.calBookingUid,
				companyId: params.companyId,
				contactId: params.contactId,
				endAt: new Date(booking.endTimeIso),
				meetingUrl: booking.meetingUrl,
				notes: `Booked autonomously via SDR reply flow (${booking.simulated ? "sandbox" : "cal.com"}).`,
				organizationId: params.organizationId,
				startAt: new Date(booking.startTimeIso),
				status: "scheduled",
				threadId: params.threadId,
				timezone: classification.detectedTimezone || params.prospectTimezone,
				title: `Ledgerwise Discovery — ${params.companyName}`,
			})
			.onConflictDoNothing()
			.returning({ id: meetings.id });

		if (insertedMeeting) {
			await tx
				.update(companies)
				.set({ status: "meeting_booked" })
				.where(
					and(
						eq(companies.id, params.companyId),
						eq(companies.organizationId, params.organizationId)
					)
				);
			bookingCreated = true;
		}
	}

	if (!bookingCreated) {
		await tx
			.update(companies)
			.set({ status: "replied" })
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId),
					notInArray(companies.status, [
						"suppressed",
						"disqualified",
						"meeting_booked",
					])
				)
			);
	}

	if (!replyDraft) {
		await tx
			.update(threads)
			.set({
				...(bookingCreated
					? { aiMode: "paused" as const, status: "booked" as const }
					: {}),
				...(nextTimezone ? { prospectTimezone: nextTimezone } : {}),
				pendingJobId: null,
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);
		return { bookingCreated };
	}

	const isAutoSend = params.pipelineResult.action === "auto_send_reply";
	const sendInline = isAutoSend && params.shouldSendInline;
	const [createdReply] = await tx
		.insert(messages)
		.values({
			aiOriginalBody: replyDraft.body,
			author: "ai",
			bodyText: replyDraft.body,
			citations: [],
			decisionSummary: classification.rationale,
			direction: "outbound",
			inReplyTo: params.inboundProviderMessageId,
			organizationId: params.organizationId,
			sentAt: sendInline ? params.now : null,
			status: resolveOutboundMessageStatus(isAutoSend, sendInline),
			subject: replyDraft.subject,
			threadId: params.threadId,
		})
		.returning({ id: messages.id });

	await tx
		.update(threads)
		.set({
			aiMode: bookingCreated ? "paused" : params.currentAiMode,
			...(sendInline ? { aiReplyCount: sql`${threads.aiReplyCount} + 1` } : {}),
			...(nextTimezone ? { prospectTimezone: nextTimezone } : {}),
			lastMessageAt: params.now,
			offeredSlots,
			pendingJobId: null,
			status: resolveReplyThreadStatus(bookingCreated, isAutoSend),
		})
		.where(
			and(
				eq(threads.id, params.threadId),
				eq(threads.organizationId, params.organizationId)
			)
		);

	return { bookingCreated, replyMessageId: createdReply?.id };
}

async function dispatchPostInboundHooks(params: {
	bookingCreated: boolean;
	companyId: string;
	companyName: string;
	escalationReason: string;
	inboundMessageId: string;
	onAutoSendReply?: ExecuteInboundReplyParams["onAutoSendReply"];
	onNotify?: ExecuteInboundReplyParams["onNotify"];
	organizationId: string;
	pipelineResult: InboundReplyPipelineOutput;
	replyMessageId?: string;
	threadId: string;
}) {
	if (
		params.pipelineResult.action === "auto_send_reply" &&
		params.replyMessageId &&
		params.onAutoSendReply
	) {
		await params.onAutoSendReply({
			messageId: params.replyMessageId,
			organizationId: params.organizationId,
			threadId: params.threadId,
		});
	}

	if (!params.onNotify) {
		return;
	}

	if (params.pipelineResult.action === "escalate_to_human") {
		await params.onNotify({
			companyId: params.companyId,
			companyName: params.companyName,
			inboundMessageId: params.inboundMessageId,
			reason: params.escalationReason,
			threadId: params.threadId,
			type: "sdr_needs_human",
		});
	} else if (params.bookingCreated && params.pipelineResult.booking) {
		await params.onNotify({
			calBookingUid: params.pipelineResult.booking.calBookingUid,
			companyId: params.companyId,
			companyName: params.companyName,
			inboundMessageId: params.inboundMessageId,
			startTimeIso: params.pipelineResult.booking.startTimeIso,
			threadId: params.threadId,
			type: "sdr_meeting_booked",
		});
	}

	if (
		params.pipelineResult.action === "draft_for_review" &&
		params.replyMessageId
	) {
		await params.onNotify({
			companyId: params.companyId,
			companyName: params.companyName,
			inboundMessageId: params.inboundMessageId,
			messageId: params.replyMessageId,
			threadId: params.threadId,
			type: "sdr_review_ready",
		});
	}
}

/**
 * Shared transactional inbound execution + persistence used by both BullMQ inbound worker
 * and offline API simulator fallback so all opt-out, pause, human-mode, booking, and
 * escalation invariants stay identical.
 */
export async function executeAndPersistInboundReply(
	params: ExecuteInboundReplyParams
): Promise<ExecuteInboundReplyResult> {
	const ctx = await loadInboundExecutionContext(
		params.inboundMessageId,
		params.organizationId,
		params.threadId
	);

	// Idempotency guard: never re-run LLMs or Cal.com booking if already classified/processed.
	if (ctx.inboundMsg.classification !== null) {
		return { action: "already_processed", bookingCreated: false };
	}

	// Hard suppression / opted-out gate before any classification, booking, or reply drafting
	if (ctx.thread.status === "opted_out" || ctx.suppressedRow) {
		const claimedOptOut = await db.transaction(async (tx) => {
			const [claimed] = await tx
				.update(messages)
				.set({
					classification: buildSuppressedClassification(
						"Suppressed / opted-out contact; inbound skipped without AI reply or booking."
					),
				})
				.where(
					and(
						eq(messages.id, ctx.inboundMsg.id),
						eq(messages.organizationId, params.organizationId),
						isNull(messages.classification)
					)
				)
				.returning({ id: messages.id });

			if (!claimed) {
				return false;
			}

			await tx
				.update(threads)
				.set({
					aiMode: "paused",
					pendingJobId: null,
					status: "opted_out",
				})
				.where(
					and(
						eq(threads.id, ctx.thread.id),
						eq(threads.organizationId, params.organizationId)
					)
				);
			return true;
		});
		return {
			action: claimedOptOut ? "opt_out_halt" : "already_processed",
			bookingCreated: false,
		};
	}

	const companyName = ctx.company?.name ?? "your company";
	const contactName = ctx.contact?.fullName ?? "there";

	const rawPipelineResult = await runInboundReplyPipeline({
		aiDisclosureMode: ctx.settings.aiDisclosure,
		aiReplyCount: ctx.thread.aiReplyCount,
		autopilotMode: ctx.settings.autopilot,
		calcomApiKey: params.calcomApiKey,
		calcomEventTypeId: params.calcomEventTypeId,
		companyName,
		contactEmail: ctx.contactEmail,
		contactName,
		existingBookingUid: ctx.activeBooking?.calBookingUid ?? null,
		googleApiKey: params.googleApiKey,
		inboundBody: ctx.inboundMsg.bodyText,
		openrouterApiKey: params.openrouterApiKey,
		playbook: ctx.settings.playbook,
		previousOfferedSlots: ctx.thread.offeredSlots ?? [],
		prospectTimezone: ctx.thread.prospectTimezone,
		recentMessages: ctx.recentMessages,
		requireLlm: params.requireLlm,
		sdrGeminiModel: params.sdrGeminiModel,
		sdrModelFast: params.sdrModelFast,
		sdrModelSmart: params.sdrModelSmart,
		subject: ctx.inboundMsg.subject,
		threadAiMode: ctx.thread.aiMode,
		threadStatus: ctx.thread.status,
	});

	let pipelineResult = rawPipelineResult;
	if (rawPipelineResult.action === "auto_send_reply") {
		const capStatus = await getDailySendCapStatus(params.organizationId);
		if (capStatus.reached) {
			pipelineResult = {
				...rawPipelineResult,
				action: "draft_for_review",
				classification: {
					...rawPipelineResult.classification,
					rationale: `${rawPipelineResult.classification.rationale} (Held for review: daily send cap of ${capStatus.cap} reached.)`,
				},
			};
		}
	}

	const now = new Date();
	const displayCompanyName = ctx.company?.name ?? "Prospect";
	const escalationReason =
		pipelineResult.escalationReason ??
		"Escalated to human sales team for review.";

	const persisted = await db.transaction(async (tx) => {
		const [claimedInbound] = await tx
			.update(messages)
			.set({ classification: pipelineResult.classification })
			.where(
				and(
					eq(messages.id, ctx.inboundMsg.id),
					eq(messages.organizationId, params.organizationId),
					isNull(messages.classification)
				)
			)
			.returning({ id: messages.id });

		if (!claimedInbound) {
			return null;
		}

		let outcome: { bookingCreated: boolean; replyMessageId?: string } = {
			bookingCreated: false,
		};

		if (
			pipelineResult.action === "opt_out_halt" ||
			pipelineResult.action === "ooo_pause" ||
			pipelineResult.action === "escalate_to_human"
		) {
			await persistTerminalOutcomeInTx(tx, {
				action: pipelineResult.action,
				companyDomain: ctx.company?.domain ?? null,
				companyId: ctx.thread.companyId,
				contactEmail: ctx.contactEmail,
				currentThreadStatus: ctx.thread.status,
				detectedTimezone: pipelineResult.classification.detectedTimezone,
				escalationReason,
				inboundMessageId: ctx.inboundMsg.id,
				now,
				organizationId: params.organizationId,
				threadId: ctx.thread.id,
			});
		} else {
			outcome = await persistBookingAndReplyInTx(tx, {
				companyId: ctx.thread.companyId,
				companyName,
				contactEmail: ctx.contactEmail,
				contactId: ctx.thread.contactId,
				currentAiMode: ctx.thread.aiMode,
				inboundProviderMessageId: ctx.inboundMsg.providerMessageId ?? null,
				now,
				organizationId: params.organizationId,
				pipelineResult,
				prospectTimezone: ctx.thread.prospectTimezone,
				shouldSendInline: !params.onAutoSendReply,
				threadId: ctx.thread.id,
			});
		}

		const runRows = buildAgentRunRows({
			companyId: ctx.thread.companyId,
			inboundMessageId: ctx.inboundMsg.id,
			messageId: outcome.replyMessageId,
			organizationId: params.organizationId,
			pipelineResult,
			threadId: ctx.thread.id,
		});
		if (runRows.length > 0) {
			await tx.insert(agentRuns).values(runRows);
		}

		return outcome;
	});

	if (!persisted) {
		return { action: "already_processed", bookingCreated: false };
	}

	await dispatchPostInboundHooks({
		bookingCreated: persisted.bookingCreated,
		companyId: ctx.thread.companyId,
		companyName: displayCompanyName,
		escalationReason,
		inboundMessageId: ctx.inboundMsg.id,
		onAutoSendReply: params.onAutoSendReply,
		onNotify: params.onNotify,
		organizationId: params.organizationId,
		pipelineResult,
		replyMessageId: persisted.replyMessageId,
		threadId: ctx.thread.id,
	});

	return {
		action: pipelineResult.action,
		bookingCreated: persisted.bookingCreated,
		replyMessageId: persisted.replyMessageId,
	};
}

/** Transactionally escalate/pause a thread when inbound reply processing fails terminally. */
export async function recoverInboundReplyFailure(params: {
	organizationId: string;
	reason: string;
	threadId: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const [existingThread] = await tx
			.select({
				companyId: threads.companyId,
				id: threads.id,
				status: threads.status,
			})
			.from(threads)
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			)
			.limit(1);

		if (!existingThread) {
			return;
		}

		const nextStatus: ThreadStatus =
			existingThread.status === "human" || existingThread.status === "opted_out"
				? existingThread.status
				: "needs_human";

		await tx
			.update(threads)
			.set({
				aiMode: "paused",
				handoffReason: params.reason.slice(0, 240),
				pendingJobId: null,
				status: nextStatus,
			})
			.where(
				and(
					eq(threads.id, existingThread.id),
					eq(threads.organizationId, params.organizationId)
				)
			);

		await tx
			.update(companies)
			.set({ status: "replied" })
			.where(
				and(
					eq(companies.id, existingThread.companyId),
					eq(companies.organizationId, params.organizationId),
					notInArray(companies.status, [
						"suppressed",
						"disqualified",
						"meeting_booked",
					])
				)
			);
	});
}

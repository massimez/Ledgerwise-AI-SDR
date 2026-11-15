import { db } from "@workspace/db";
import {
	type CompanyStatus,
	companies,
	contacts,
	messages,
	sdrSettings,
	suppressions,
	type ThreadStatus,
	threads,
} from "@workspace/db/schema/sdr";
import { and, count, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

export type SdrDbExecutor =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DailySendCapStatus {
	cap: number;
	reached: boolean;
	remaining: number;
	used: number;
}

const DEFAULT_DAILY_SEND_CAP = 50;

/** Load a single thread scoped to the tenant organization. */
export async function findThreadById(organizationId: string, threadId: string) {
	const [thread] = await db
		.select()
		.from(threads)
		.where(withOrg(threads, organizationId, eq(threads.id, threadId)))
		.limit(1);

	return thread ?? null;
}

/** Find a suppression record for a contact inside an organization (case-insensitive email match). */
/** Find a suppression record for a raw email inside an organization (case-insensitive email match). */
export async function findSuppressedEmail(
	organizationId: string,
	email: string
) {
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail) {
		return null;
	}

	const [suppressed] = await db
		.select({ id: suppressions.id, reason: suppressions.reason })
		.from(suppressions)
		.where(
			withOrg(
				suppressions,
				organizationId,
				eq(sql`lower(${suppressions.email})`, normalizedEmail)
			)
		)
		.limit(1);

	return suppressed ?? null;
}

/** Find a suppression record for a contact inside an organization (case-insensitive email match). */
export async function findContactSuppression(
	organizationId: string,
	contactId: string
) {
	const [contact] = await db
		.select()
		.from(contacts)
		.where(withOrg(contacts, organizationId, eq(contacts.id, contactId)))
		.limit(1);

	if (!contact?.email) {
		return null;
	}

	const suppressed = await findSuppressedEmail(organizationId, contact.email);
	return suppressed
		? { email: contact.email, reason: suppressed.reason }
		: null;
}

/** Check today's UTC outbound send volume against `sdr_settings.daily_send_cap`. */
export async function getDailySendCapStatus(
	organizationId: string,
	options: {
		excludeMessageId?: string;
		now?: Date;
	} = {},
	executor: SdrDbExecutor = db
): Promise<DailySendCapStatus> {
	const now = options.now ?? new Date();
	const startOfUtcDay = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
	);

	const [[settings], [usage]] = await Promise.all([
		executor
			.select({ dailySendCap: sdrSettings.dailySendCap })
			.from(sdrSettings)
			.where(eq(sdrSettings.organizationId, organizationId))
			.limit(1),
		executor
			.select({ total: count() })
			.from(messages)
			.where(
				and(
					eq(messages.organizationId, organizationId),
					eq(messages.direction, "outbound"),
					inArray(messages.status, ["approved", "queued", "sent"]),
					or(
						gte(messages.sentAt, startOfUtcDay),
						and(isNull(messages.sentAt), gte(messages.createdAt, startOfUtcDay))
					),
					...(options.excludeMessageId
						? [ne(messages.id, options.excludeMessageId)]
						: [])
				)
			),
	]);

	const cap = settings?.dailySendCap ?? DEFAULT_DAILY_SEND_CAP;
	const used = Number(usage?.total ?? 0);
	return {
		cap,
		reached: used >= cap,
		remaining: Math.max(0, cap - used),
		used,
	};
}

/** Mark an approved/queued outbound message sent when Redis is offline in non-prod. */
export async function markMessageSentFallback(messageId: string, sentAt: Date) {
	const [updated] = await db
		.update(messages)
		.set({
			sentAt,
			status: "sent",
		})
		.where(eq(messages.id, messageId))
		.returning();

	return updated ?? null;
}

/** Revert an approved review draft back to `pending_review` if queue dispatch fails. */
export async function revertApprovedDraftAfterQueueFailure(params: {
	companyId: string;
	messageId: string;
	organizationId: string;
	previousBodyText: string;
	previousCompanyStatus: CompanyStatus;
	previousDecisionSummary: string | null;
	previousLastMessageAt: Date;
	previousSubject: string;
	previousThreadStatus: ThreadStatus;
	threadId: string;
}) {
	await db.transaction(async (tx) => {
		await tx
			.update(messages)
			.set({
				approvedBy: null,
				bodyText: params.previousBodyText,
				decisionSummary: params.previousDecisionSummary,
				status: "pending_review",
				subject: params.previousSubject,
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId)
				)
			);

		await tx
			.update(threads)
			.set({
				lastMessageAt: params.previousLastMessageAt,
				status: params.previousThreadStatus,
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);

		await tx
			.update(companies)
			.set({ status: params.previousCompanyStatus })
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			);
	});
}

/** Mark a human outbound message failed and restore thread control state if queue dispatch fails. */
export async function rollbackHumanReplyAfterQueueFailure(params: {
	messageId: string;
	organizationId: string;
	previousAiMode: "auto" | "paused";
	previousHandoffReason: string | null;
	previousLastMessageAt: Date;
	previousOwnerUserId: string | null;
	previousThreadStatus: ThreadStatus;
	threadId: string;
}) {
	await db.transaction(async (tx) => {
		await tx
			.update(messages)
			.set({
				decisionSummary: "Failed to enqueue outbound job; retry sending.",
				status: "failed",
			})
			.where(
				and(
					eq(messages.id, params.messageId),
					eq(messages.organizationId, params.organizationId)
				)
			);

		await tx
			.update(threads)
			.set({
				aiMode: params.previousAiMode,
				handoffReason: params.previousHandoffReason,
				lastMessageAt: params.previousLastMessageAt,
				ownerUserId: params.previousOwnerUserId,
				status: params.previousThreadStatus,
			})
			.where(
				and(
					eq(threads.id, params.threadId),
					eq(threads.organizationId, params.organizationId)
				)
			);
	});
}

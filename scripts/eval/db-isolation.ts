import type { RawSourceDocument } from "../../packages/ai-core/src/index";
import {
	and,
	closeDb,
	count,
	db,
	eq,
	inArray,
	schema,
} from "../../packages/db/src/index";

export interface EvalDbSnapshot {
	companyCount: number;
	threadCount: number;
}

export interface EvalDbContext {
	applyInboundPipelineOutcomeToDb: (params: {
		action:
			| "auto_replied"
			| "booked_meeting"
			| "escalate_to_human"
			| "opted_out"
			| "pause_out_of_office";
		booking?: {
			bookingUid: string;
			endIso: string;
			meetingUrl?: string;
			startIso: string;
			title: string;
		};
		companyId: string;
		contactEmail: string;
		contactId: string;
		escalationReason?: string;
		inboundBody: string;
		inboundSubject: string;
		replyDraft?: {
			body: string;
			subject: string;
		};
		threadId: string;
	}) => Promise<{
		meetingPersisted: boolean;
		outboundSendGateBlocked: boolean;
		suppressionRecorded: boolean;
		threadAiMode: string;
		threadStatusAfter: string;
	}>;
	canSendOutboundEmail: (params: {
		recipientEmail: string;
		threadId: string;
	}) => Promise<{ allowed: boolean; reason: string }>;
	cleanup: () => Promise<{
		after: EvalDbSnapshot;
		before: EvalDbSnapshot;
		isolatedOrgCleanedUp: boolean;
		liveDemoDataUnchanged: boolean;
	}>;
	evalOrgId: string;
	loadCachedCompanyDocs: () => Promise<Map<string, RawSourceDocument[]>>;
	seedInboundEvalThread: (params: {
		companyDomain: string;
		companyName: string;
		contactEmail: string;
		contactName: string;
		contactRole: string;
	}) => Promise<{
		companyId: string;
		contactId: string;
		threadId: string;
	}>;
}

async function captureDbSnapshot(): Promise<EvalDbSnapshot> {
	const [companyRow] = await db
		.select({ value: count() })
		.from(schema.companies);
	const [threadRow] = await db.select({ value: count() }).from(schema.threads);
	return {
		companyCount: Number(companyRow?.value ?? 0),
		threadCount: Number(threadRow?.value ?? 0),
	};
}

export async function createIsolatedEvalDbContext(): Promise<EvalDbContext> {
	const before = await captureDbSnapshot();
	const runUuid = crypto.randomUUID().slice(0, 12);
	const evalOrgId = `eval_org_${runUuid}`;

	await db.insert(schema.organization).values({
		createdAt: new Date(),
		id: evalOrgId,
		name: `Ledgerwise Eval Runner (${runUuid})`,
		slug: `ledgerwise-eval-${runUuid}`,
	});

	const loadCachedCompanyDocs = async (): Promise<
		Map<string, RawSourceDocument[]>
	> => {
		const companies = await db.select().from(schema.companies);
		const liveCompanies = companies.filter(
			(company) => company.organizationId !== evalOrgId
		);
		if (liveCompanies.length === 0) {
			return new Map();
		}
		const companyIds = liveCompanies.map((company) => company.id);
		const docs = await db
			.select()
			.from(schema.companySourceDocs)
			.where(inArray(schema.companySourceDocs.companyId, companyIds));

		const domainById = new Map<string, string>();
		for (const company of liveCompanies) {
			domainById.set(company.id, company.domain.toLowerCase());
		}

		const byDomain = new Map<string, RawSourceDocument[]>();
		for (const doc of docs) {
			const domain = domainById.get(doc.companyId);
			if (!(domain && doc.text)) {
				continue;
			}
			const list = byDomain.get(domain) ?? [];
			list.push({
				fetchedAt: doc.fetchedAt.toISOString(),
				sourceType: doc.sourceType,
				text: doc.text,
				title: doc.title || doc.url,
				url: doc.url,
			});
			byDomain.set(domain, list);
		}
		return byDomain;
	};

	const seedInboundEvalThread: EvalDbContext["seedInboundEvalThread"] = async (
		params
	) => {
		const uniqueDomain = `${params.companyDomain}-${crypto.randomUUID().slice(0, 6)}.eval.local`;
		const [company] = await db
			.insert(schema.companies)
			.values({
				channels: ["shopify", "amazon"],
				domain: uniqueDomain,
				hqLocation: "Austin, TX",
				name: params.companyName,
				organizationId: evalOrgId,
				score: 85,
				status: "qualified",
				summary: `${params.companyName} is a qualified US Shopify e-commerce brand.`,
				tier: "A",
				website: `https://${uniqueDomain}`,
			})
			.returning();

		if (!company) {
			throw new Error("Failed to seed isolated eval company");
		}

		const [contact] = await db
			.insert(schema.contacts)
			.values({
				companyId: company.id,
				email: params.contactEmail.toLowerCase(),
				emailStatus: "verified",
				fullName: params.contactName,
				organizationId: evalOrgId,
				persona: "founder",
				title: params.contactRole,
			})
			.returning();

		if (!contact) {
			throw new Error("Failed to seed isolated eval contact");
		}

		const [thread] = await db
			.insert(schema.threads)
			.values({
				aiMode: "auto",
				companyId: company.id,
				contactId: contact.id,
				lastMessageAt: new Date(),
				organizationId: evalOrgId,
				replyToken: `eval_tok_${crypto.randomUUID().replaceAll("-", "")}`,
				status: "active",
			})
			.returning();

		if (!thread) {
			throw new Error("Failed to seed isolated eval thread");
		}

		await db.insert(schema.messages).values({
			author: "ai",
			bodyText: `Hi ${params.contactName.split(" ")[0] ?? "there"}, saw ${params.companyName} is growing across Shopify and Amazon. Open to a quick look at how Ledgerwise automates COGS and inventory reconciliation?`,
			direction: "outbound",
			organizationId: evalOrgId,
			sentAt: new Date(Date.now() - 3_600_000),
			status: "sent",
			subject: `Scaling bookkeeping at ${params.companyName}`,
			threadId: thread.id,
		});

		return {
			companyId: company.id,
			contactId: contact.id,
			threadId: thread.id,
		};
	};

	const canSendOutboundEmail: EvalDbContext["canSendOutboundEmail"] = async (
		params
	) => {
		const normalizedEmail = params.recipientEmail.trim().toLowerCase();
		const [suppression] = await db
			.select()
			.from(schema.suppressions)
			.where(
				and(
					eq(schema.suppressions.organizationId, evalOrgId),
					eq(schema.suppressions.email, normalizedEmail)
				)
			)
			.limit(1);

		if (suppression) {
			return {
				allowed: false,
				reason: `Recipient ${normalizedEmail} is in suppressions (${suppression.reason})`,
			};
		}

		const [thread] = await db
			.select()
			.from(schema.threads)
			.where(
				and(
					eq(schema.threads.organizationId, evalOrgId),
					eq(schema.threads.id, params.threadId)
				)
			)
			.limit(1);

		if (!thread) {
			return { allowed: false, reason: "Thread not found" };
		}
		if (thread.status === "opted_out") {
			return { allowed: false, reason: "Thread is marked opted_out" };
		}
		if (thread.aiMode === "paused") {
			return { allowed: false, reason: "Thread AI mode is paused" };
		}
		return { allowed: true, reason: "Allowed" };
	};

	const persistBookedMeetingMutation = async (
		params: Parameters<EvalDbContext["applyInboundPipelineOutcomeToDb"]>[0],
		normalizedEmail: string
	) => {
		if (params.booking) {
			const uniqueCalUid = `${params.booking.bookingUid}_${crypto.randomUUID().slice(0, 8)}`;
			await db.insert(schema.meetings).values({
				attendeeEmail: normalizedEmail,
				calBookingUid: uniqueCalUid,
				companyId: params.companyId,
				contactId: params.contactId,
				endAt: new Date(params.booking.endIso),
				meetingUrl: params.booking.meetingUrl ?? null,
				notes: params.booking.title,
				organizationId: evalOrgId,
				startAt: new Date(params.booking.startIso),
				status: "scheduled",
				threadId: params.threadId,
				timezone: "America/New_York",
				title: params.booking.title,
			});
		}
		if (params.replyDraft) {
			await db.insert(schema.messages).values({
				author: "ai",
				bodyText: params.replyDraft.body,
				direction: "outbound",
				organizationId: evalOrgId,
				sentAt: new Date(),
				status: "sent",
				subject: params.replyDraft.subject,
				threadId: params.threadId,
			});
		}
		await db
			.update(schema.companies)
			.set({ status: "meeting_booked", updatedAt: new Date() })
			.where(eq(schema.companies.id, params.companyId));
		await db
			.update(schema.threads)
			.set({
				lastMessageAt: new Date(),
				status: "booked",
				updatedAt: new Date(),
			})
			.where(eq(schema.threads.id, params.threadId));
	};

	const applyInboundPipelineOutcomeToDb: EvalDbContext["applyInboundPipelineOutcomeToDb"] =
		async (params) => {
			const normalizedEmail = params.contactEmail.trim().toLowerCase();
			const [inboundMsg] = await db
				.insert(schema.messages)
				.values({
					author: "prospect",
					bodyText: params.inboundBody,
					direction: "inbound",
					organizationId: evalOrgId,
					sentAt: new Date(),
					status: "sent",
					subject: params.inboundSubject,
					threadId: params.threadId,
				})
				.returning();

			if (params.action === "opted_out") {
				await db
					.insert(schema.suppressions)
					.values({
						companyId: params.companyId,
						domain: normalizedEmail.split("@")[1] ?? null,
						email: normalizedEmail,
						organizationId: evalOrgId,
						reason: "opt_out",
						sourceMessageId: inboundMsg?.id ?? null,
					})
					.onConflictDoNothing();

				await db
					.update(schema.companies)
					.set({ status: "suppressed", updatedAt: new Date() })
					.where(eq(schema.companies.id, params.companyId));

				await db
					.update(schema.threads)
					.set({
						aiMode: "paused",
						lastMessageAt: new Date(),
						status: "opted_out",
						updatedAt: new Date(),
					})
					.where(eq(schema.threads.id, params.threadId));
			} else if (params.action === "escalate_to_human") {
				await db
					.update(schema.threads)
					.set({
						aiMode: "paused",
						handoffReason:
							params.escalationReason ?? "Escalated to human reviewer",
						lastMessageAt: new Date(),
						status: "needs_human",
						updatedAt: new Date(),
					})
					.where(eq(schema.threads.id, params.threadId));
			} else if (params.action === "booked_meeting") {
				await persistBookedMeetingMutation(params, normalizedEmail);
			} else if (params.action === "auto_replied" && params.replyDraft) {
				await db.insert(schema.messages).values({
					author: "ai",
					bodyText: params.replyDraft.body,
					direction: "outbound",
					organizationId: evalOrgId,
					sentAt: new Date(),
					status: "sent",
					subject: params.replyDraft.subject,
					threadId: params.threadId,
				});
				await db
					.update(schema.threads)
					.set({
						lastMessageAt: new Date(),
						status: "active",
						updatedAt: new Date(),
					})
					.where(eq(schema.threads.id, params.threadId));
			}

			const [updatedThread] = await db
				.select()
				.from(schema.threads)
				.where(eq(schema.threads.id, params.threadId))
				.limit(1);

			const [suppressionRow] = await db
				.select()
				.from(schema.suppressions)
				.where(
					and(
						eq(schema.suppressions.organizationId, evalOrgId),
						eq(schema.suppressions.email, normalizedEmail)
					)
				)
				.limit(1);

			const [meetingRow] = await db
				.select()
				.from(schema.meetings)
				.where(
					and(
						eq(schema.meetings.organizationId, evalOrgId),
						eq(schema.meetings.threadId, params.threadId)
					)
				)
				.limit(1);

			const sendGate = await canSendOutboundEmail({
				recipientEmail: normalizedEmail,
				threadId: params.threadId,
			});

			return {
				meetingPersisted: Boolean(meetingRow),
				outboundSendGateBlocked: !sendGate.allowed,
				suppressionRecorded: Boolean(suppressionRow),
				threadAiMode: updatedThread?.aiMode ?? "unknown",
				threadStatusAfter: updatedThread?.status ?? "unknown",
			};
		};

	const cleanup: EvalDbContext["cleanup"] = async () => {
		await db
			.delete(schema.organization)
			.where(eq(schema.organization.id, evalOrgId));

		const [remainingOrg] = await db
			.select()
			.from(schema.organization)
			.where(eq(schema.organization.id, evalOrgId))
			.limit(1);

		const after = await captureDbSnapshot();
		return {
			after,
			before,
			isolatedOrgCleanedUp: !remainingOrg,
			liveDemoDataUnchanged:
				before.companyCount === after.companyCount &&
				before.threadCount === after.threadCount,
		};
	};

	return {
		applyInboundPipelineOutcomeToDb,
		canSendOutboundEmail,
		cleanup,
		evalOrgId,
		loadCachedCompanyDocs,
		seedInboundEvalThread,
	};
}

export async function closeEvalDb(): Promise<void> {
	await closeDb();
}

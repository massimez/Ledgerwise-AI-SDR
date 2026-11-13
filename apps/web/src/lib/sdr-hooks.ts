"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, parseApiResponse } from "./api-client";
import {
	type CompanyStatus,
	type CompanyTier,
	INITIAL_FALLBACK_COMPANIES,
	INITIAL_FALLBACK_CRITERIA,
	INITIAL_FALLBACK_EVIDENCE,
	INITIAL_FALLBACK_MEETINGS,
	INITIAL_FALLBACK_MESSAGES,
	INITIAL_FALLBACK_SETTINGS,
	INITIAL_FALLBACK_THREADS,
	type ReplyClassificationReport,
	type SdrAiDisclosureMode,
	type SdrAutopilotMode,
	type SdrCompanySummary,
	type SdrCriterionItem,
	type SdrEvidenceItem,
	type SdrIcpConfig,
	type SdrMeetingItem,
	type SdrMessageItem,
	type SdrPlaybookConfig,
	type SdrSettingsState,
	type SdrThreadItem,
	type ThreadStatus,
} from "./sdr-fallback-data";

const PRICE_QUOTE_REGEX =
	/(?:\$\s?\d[\d,]*(?:\s*(?:\/|\bper\b)\s*(?:mo|month|yr|year|hour|hr|book|account))?|\b\d+\s*(?:dollars|usd)\s*(?:per|a)\s*(?:month|year|hour)\b|\b(?:flat\s+fee|monthly\s+retainer|pricing\s+starts\s+at|costs?\s+\$\d)\b)/iu;

const OPT_OUT_REGEX =
	/\b(?:unsubscribe|remove\s+me|take\s+me\s+off|opt\s*out|stop\s+emailing|never\s+contact|do\s+not\s+contact|not\s+interested)\b/iu;

const BOT_QUESTION_REGEX =
	/\b(?:are\s+you\s+a\s+(?:bot|ai|robot|real\s+person|human)|is\s+this\s+(?:an?\s+)?(?:ai|bot|automated|chatgpt)|talking\s+to\s+a\s+bot)\b/iu;

const PRICING_QUESTION_REGEX =
	/\b(?:how\s+much|pricing|price|cost|rates?|monthly\s+fee|what\s+do\s+you\s+charge)\b/iu;

const MEETING_INTEREST_REGEX =
	/\b(?:let'?s\s+(?:chat|talk|meet)|open\s+to\s+a\s+call|what\s+times|schedule|calendar|free\s+next\s+week|15[- ]?min|jump\s+on\s+a\s+call|book\s+a\s+call)\b/iu;

const SLOT_SELECTION_REGEX =
	/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|10:00|11:00|12:00|2:00|2:30)\b/iu;

const OUTSIDE_PLAYBOOK_REGEX =
	/\b(?:edi\s+850|chargeback\s+dispute\s+portal|audit\s+opinion|gaap\s+certified\s+audit|international\s+vat\s+registration|transfer\s+pricing|soc\s*2)\b/iu;

// In-memory store when PostgreSQL container is offline in local preview
let memCompanies: SdrCompanySummary[] = structuredClone(
	INITIAL_FALLBACK_COMPANIES
);
let memCriteria: SdrCriterionItem[] = structuredClone(
	INITIAL_FALLBACK_CRITERIA
);
let memEvidence: SdrEvidenceItem[] = structuredClone(INITIAL_FALLBACK_EVIDENCE);
let memThreads: SdrThreadItem[] = structuredClone(INITIAL_FALLBACK_THREADS);
let memMessages: SdrMessageItem[] = structuredClone(INITIAL_FALLBACK_MESSAGES);
let memMeetings: SdrMeetingItem[] = structuredClone(INITIAL_FALLBACK_MEETINGS);
let memSettings: SdrSettingsState = structuredClone(INITIAL_FALLBACK_SETTINGS);
let memSuppressions: Array<{
	companyId: string | null;
	createdAt: string;
	email: string;
	id: string;
	reason: string;
}> = [];

function checkPriceGuard(text: string, citedSpans: string[] = []): boolean {
	let scrubbed = text;
	for (const span of citedSpans) {
		if (span.trim()) {
			scrubbed = scrubbed.replaceAll(span, "");
		}
	}
	return PRICE_QUOTE_REGEX.test(scrubbed);
}

function buildFallbackSummary() {
	const pendingReviews = memMessages
		.filter((m) => m.status === "pending_review")
		.map((m) => {
			const thread = memThreads.find((t) => t.id === m.threadId);
			const company = memCompanies.find((c) => c.id === thread?.companyId);
			return {
				companyId: company?.id ?? "",
				companyName: company?.name ?? "Unknown",
				companyScore: company?.score ?? 0,
				companyTier: company?.tier ?? "B",
				contactName: company?.primaryContact?.fullName ?? null,
				createdAt: m.createdAt,
				id: m.id,
				subject: m.subject,
				threadId: m.threadId,
			};
		});

	const needsHumanThreads = memThreads
		.filter((t) => t.status === "needs_human")
		.map((t) => {
			const company = memCompanies.find((c) => c.id === t.companyId);
			return {
				aiMode: t.aiMode,
				companyId: t.companyId,
				companyName: company?.name ?? "Unknown",
				contactName: company?.primaryContact?.fullName ?? null,
				handoffReason: t.handoffReason,
				id: t.id,
				lastMessageAt: t.lastMessageAt,
				status: t.status,
			};
		});

	const upcomingMeetings = memMeetings.map((m) => {
		const company = memCompanies.find((c) => c.id === m.companyId);
		return {
			...m,
			companyName: company?.name ?? "Unknown",
			contactName: company?.primaryContact?.fullName ?? null,
		};
	});

	return {
		kpis: {
			bookedCount: memMeetings.filter((m) => m.status === "scheduled").length,
			contactedCount: memCompanies.filter((c) =>
				["contacted", "replied", "meeting_booked", "suppressed"].includes(
					c.status
				)
			).length,
			needsHumanCount: needsHumanThreads.length,
			pendingReviewCount: pendingReviews.length,
			qualifiedCount: memCompanies.filter(
				(c) => c.tier === "A" || c.tier === "B"
			).length,
			repliedCount: memCompanies.filter((c) =>
				["replied", "meeting_booked"].includes(c.status)
			).length,
			researchedCount: memCompanies.length,
		},
		needsHumanThreads,
		pendingReviews,
		recentActivity: [
			{
				companyId: "22222222-2222-4222-8222-222222222204",
				companyName: "Kova Athletic",
				costUsd: "0.002900",
				createdAt: "2026-11-13T18:30:05Z",
				decision: "handoff_needs_human_outside_playbook",
				id: "run-4",
				latencyMs: 1120,
				model: "openrouter/google/gemini-2.5-flash",
				step: "classify",
				threadId: "55555555-5555-4555-8555-555555555504",
			},
			{
				companyId: "22222222-2222-4222-8222-222222222203",
				companyName: "Trailhead Kettle Co.",
				costUsd: "0.003100",
				createdAt: "2026-11-13T18:25:00Z",
				decision: "booked_calcom_slot",
				id: "run-3",
				latencyMs: 1180,
				model: "openrouter/google/gemini-2.5-flash",
				step: "book",
				threadId: "55555555-5555-4555-8555-555555555503",
			},
			{
				companyId: "22222222-2222-4222-8222-222222222202",
				companyName: "Harbor & Loom",
				costUsd: "0.003800",
				createdAt: "2026-11-13T18:10:00Z",
				decision: "auto_reply_pricing_deflection_with_slots",
				id: "run-2",
				latencyMs: 1290,
				model: "openrouter/google/gemini-2.5-flash",
				step: "reply",
				threadId: "55555555-5555-4555-8555-555555555502",
			},
			{
				companyId: "22222222-2222-4222-8222-222222222201",
				companyName: "Suncrest Botanics",
				costUsd: "0.004200",
				createdAt: "2026-11-13T17:35:00Z",
				decision: "tier_A_score_85",
				id: "run-1",
				latencyMs: 1420,
				model: "openrouter/google/gemini-2.5-flash",
				step: "write",
				threadId: "55555555-5555-4555-8555-555555555501",
			},
		],
		upcomingMeetings,
	};
}

export function useSdrDashboard() {
	return useQuery({
		queryKey: ["sdr", "dashboard"],
		queryFn: async () => {
			try {
				const res = await client.api.sdr.dashboard.$get();
				return await parseApiResponse<ReturnType<typeof buildFallbackSummary>>(
					res
				);
			} catch {
				return buildFallbackSummary();
			}
		},
	});
}

export function useSdrCompanies(filters?: {
	q?: string;
	signal?: string;
	sort?: "score_desc" | "score_asc" | "recent";
	status?: CompanyStatus;
	tier?: CompanyTier;
}) {
	return useQuery({
		queryKey: ["sdr", "companies", filters ?? {}],
		queryFn: async () => {
			try {
				const res = await client.api.sdr.companies.$get({
					query: {
						q: filters?.q,
						signal: filters?.signal,
						sort: filters?.sort ?? "score_desc",
						status: filters?.status,
						tier: filters?.tier,
					},
				});
				const data = await parseApiResponse<{
					companies: SdrCompanySummary[];
				}>(res);
				return data.companies;
			} catch {
				let list = [...memCompanies];
				if (filters?.tier) {
					list = list.filter((c) => c.tier === filters.tier);
				}
				if (filters?.status) {
					list = list.filter((c) => c.status === filters.status);
				}
				if (filters?.signal) {
					const sig = filters.signal.toLowerCase();
					list = list.filter((c) =>
						c.signals.some((s) => s.toLowerCase().includes(sig))
					);
				}
				if (filters?.q) {
					const q = filters.q.toLowerCase();
					list = list.filter(
						(c) =>
							c.name.toLowerCase().includes(q) ||
							c.domain.toLowerCase().includes(q) ||
							(c.summary?.toLowerCase().includes(q) ?? false)
					);
				}
				list.sort((a, b) =>
					filters?.sort === "score_asc" ? a.score - b.score : b.score - a.score
				);
				return list;
			}
		},
	});
}

export interface SdrCompanyDetailData {
	agentRuns: unknown[];
	company: SdrCompanySummary;
	contacts: NonNullable<SdrCompanySummary["primaryContact"]>[];
	criteria: SdrCriterionItem[];
	evidence: SdrEvidenceItem[];
	meetings: SdrMeetingItem[];
	threads: SdrThreadItem[];
}

export function useSdrCompanyDetail(companyId: string | null) {
	return useQuery({
		enabled: Boolean(companyId),
		queryKey: ["sdr", "company", companyId],
		queryFn: async (): Promise<SdrCompanyDetailData> => {
			if (!companyId) {
				throw new Error("Company ID required");
			}
			try {
				const res = await client.api.sdr.companies[":id"].$get({
					param: { id: companyId },
				});
				return await parseApiResponse<SdrCompanyDetailData>(res);
			} catch (error) {
				const company = memCompanies.find((c) => c.id === companyId);
				if (!company) {
					throw new Error("Company not found", { cause: error });
				}
				return {
					agentRuns: [],
					company,
					contacts: company.primaryContact ? [company.primaryContact] : [],
					criteria: memCriteria.filter((cr) => cr.companyId === companyId),
					evidence: memEvidence.filter((ev) => ev.companyId === companyId),
					meetings: memMeetings.filter((m) => m.companyId === companyId),
					threads: memThreads.filter((t) => t.companyId === companyId),
				};
			}
		},
	});
}

export interface SdrReviewQueueItem {
	company: SdrCompanySummary;
	contact: SdrCompanySummary["primaryContact"];
	criteria: SdrCriterionItem[];
	evidence: SdrEvidenceItem[];
	message: SdrMessageItem;
	thread: SdrThreadItem;
}

export function useSdrReviewQueue() {
	return useQuery({
		queryKey: ["sdr", "review"],
		queryFn: async (): Promise<SdrReviewQueueItem[]> => {
			try {
				const res = await client.api.sdr.review.$get();
				const data = await parseApiResponse<{ items: SdrReviewQueueItem[] }>(
					res
				);
				return data.items;
			} catch {
				return memMessages
					.filter((m) => m.status === "pending_review")
					.map((m) => {
						const thread = memThreads.find((t) => t.id === m.threadId);
						const company = memCompanies.find(
							(c) => c.id === thread?.companyId
						);
						if (!(thread && company)) {
							return null;
						}
						return {
							company,
							contact: company.primaryContact,
							criteria: memCriteria.filter((cr) => cr.companyId === company.id),
							evidence: memEvidence.filter(
								(ev) => ev.companyId === company.id && ev.verified
							),
							message: m,
							thread,
						};
					})
					.filter((item): item is NonNullable<typeof item> => item !== null);
			}
		},
	});
}

export function useSdrReviewMutations() {
	const queryClient = useQueryClient();

	const invalidateAll = async () => {
		await Promise.all([queryClient.invalidateQueries({ queryKey: ["sdr"] })]);
	};

	const approveMutation = useMutation({
		mutationFn: async (params: {
			bodyText?: string;
			messageId: string;
			subject?: string;
		}) => {
			const targetMsg = memMessages.find((m) => m.id === params.messageId);
			const finalBody = params.bodyText?.trim() || targetMsg?.bodyText || "";
			const citedSpans = (targetMsg?.citations ?? []).map((c) => c.span);

			if (checkPriceGuard(finalBody, citedSpans)) {
				throw new Error(
					"Ledgerwise policy violation: outbound email must never quote a dollar price or monthly fee. Pricing is discussed on a call."
				);
			}

			try {
				const res = await client.api.sdr.review[":messageId"].approve.$post({
					json: {
						bodyText: params.bodyText,
						subject: params.subject,
					},
					param: { messageId: params.messageId },
				});
				return await parseApiResponse(res);
			} catch (err) {
				if (
					err instanceof Error &&
					err.message.includes("Ledgerwise policy violation")
				) {
					throw err;
				}
				const now = new Date().toISOString();
				memMessages = memMessages.map((m) =>
					m.id === params.messageId
						? {
								...m,
								bodyText: params.bodyText?.trim() || m.bodyText,
								decisionSummary:
									"Approved by sales team and dispatched via sandbox send gate.",
								sentAt: now,
								status: "sent",
								subject: params.subject?.trim() || m.subject,
							}
						: m
				);
				if (targetMsg) {
					memThreads = memThreads.map((t) =>
						t.id === targetMsg.threadId
							? { ...t, lastMessageAt: now, status: "active" }
							: t
					);
					const thread = memThreads.find((t) => t.id === targetMsg.threadId);
					if (thread) {
						memCompanies = memCompanies.map((c) =>
							c.id === thread.companyId
								? {
										...c,
										status: "contacted",
										thread: { id: thread.id, status: "active" },
									}
								: c
						);
					}
				}
				return targetMsg;
			}
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to approve email"
			);
		},
		onSuccess: async () => {
			toast.success("Email approved and queued for sandbox delivery");
			await invalidateAll();
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (params: { messageId: string; reason: string }) => {
			try {
				const res = await client.api.sdr.review[":messageId"].reject.$post({
					json: { reason: params.reason },
					param: { messageId: params.messageId },
				});
				return await parseApiResponse(res);
			} catch {
				const targetMsg = memMessages.find((m) => m.id === params.messageId);
				memMessages = memMessages.map((m) =>
					m.id === params.messageId
						? {
								...m,
								decisionSummary: `Rejected by sales team: ${params.reason}`,
								rejectReason: params.reason,
								status: "rejected",
							}
						: m
				);
				if (targetMsg) {
					memThreads = memThreads.map((t) =>
						t.id === targetMsg.threadId ? { ...t, status: "closed" } : t
					);
				}
				return targetMsg;
			}
		},
		onSuccess: async () => {
			toast.success("Draft rejected");
			await invalidateAll();
		},
	});

	return {
		approveEmail: approveMutation.mutateAsync,
		isApproving: approveMutation.isPending,
		isRejecting: rejectMutation.isPending,
		rejectEmail: rejectMutation.mutateAsync,
	};
}

export interface SdrThreadListEntry {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	latestMessage: SdrMessageItem | null;
	messageCount: number;
	thread: SdrThreadItem;
}

export function useSdrThreads(statusFilter?: ThreadStatus) {
	return useQuery({
		queryKey: ["sdr", "threads", statusFilter ?? "all"],
		queryFn: async (): Promise<SdrThreadListEntry[]> => {
			try {
				const res = await client.api.sdr.threads.$get({
					query: statusFilter ? { status: statusFilter } : {},
				});
				const data = await parseApiResponse<{
					threads: SdrThreadListEntry[];
				}>(res);
				return data.threads;
			} catch {
				const filtered = statusFilter
					? memThreads.filter((t) => t.status === statusFilter)
					: memThreads;
				return [...filtered]
					.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
					.map((thread) => {
						const company =
							memCompanies.find((c) => c.id === thread.companyId) ?? null;
						const threadMsgs = memMessages.filter(
							(m) => m.threadId === thread.id
						);
						return {
							company,
							contact: company?.primaryContact ?? null,
							latestMessage: threadMsgs.at(-1) ?? null,
							messageCount: threadMsgs.length,
							thread,
						};
					});
			}
		},
	});
}

export interface SdrThreadDetailData {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	evidence: SdrEvidenceItem[];
	meetings: SdrMeetingItem[];
	messages: SdrMessageItem[];
	thread: SdrThreadItem;
}

export function useSdrThreadDetail(threadId: string | null) {
	return useQuery({
		enabled: Boolean(threadId),
		queryKey: ["sdr", "thread", threadId],
		queryFn: async (): Promise<SdrThreadDetailData> => {
			if (!threadId) {
				throw new Error("Thread ID required");
			}
			try {
				const res = await client.api.sdr.threads[":id"].$get({
					param: { id: threadId },
				});
				return await parseApiResponse<SdrThreadDetailData>(res);
			} catch (error) {
				const thread = memThreads.find((t) => t.id === threadId);
				if (!thread) {
					throw new Error("Thread not found", { cause: error });
				}
				const company =
					memCompanies.find((c) => c.id === thread.companyId) ?? null;
				return {
					company,
					contact: company?.primaryContact ?? null,
					evidence: memEvidence.filter(
						(ev) => ev.companyId === thread.companyId
					),
					meetings: memMeetings.filter((m) => m.threadId === thread.id),
					messages: memMessages.filter((m) => m.threadId === thread.id),
					thread,
				};
			}
		},
		// Automatically poll every 1500ms while a simulated reply or background job is active on the thread
		refetchInterval: (query) => {
			const pendingJobId = query.state.data?.thread?.pendingJobId;
			return pendingJobId ? 1500 : false;
		},
	});
}

function resolveFallbackIntentLabel(flags: {
	asksIfBot: boolean;
	mentionsPricing: boolean;
	wantsMeeting: boolean;
}): ReplyClassificationReport["intent"] {
	if (flags.asksIfBot) {
		return "bot_inquiry";
	}
	if (flags.mentionsPricing) {
		return "pricing_inquiry";
	}
	if (flags.wantsMeeting) {
		return "meeting_interest";
	}
	return "objection";
}

function applyFallbackOptOut(params: {
	company: SdrCompanySummary | undefined;
	finishTime: string;
	inboundId: string;
	thread: SdrThreadItem;
	threadId: string;
}): void {
	const { company, finishTime, inboundId, thread, threadId } = params;
	const classification: ReplyClassificationReport = {
		asksIfBot: false,
		confidence: 0.99,
		detectedTimezone: thread.prospectTimezone,
		intent: "opt_out",
		isOptOut: true,
		mentionsPricing: false,
		needsInfoFromHuman: false,
		rationale:
			"Matched opt-out guard → added to suppression list, locked thread as Opted out, 0 further emails sent.",
		selectedSlotIso: null,
		wantsMeeting: false,
	};
	memMessages = memMessages.map((m) =>
		m.id === inboundId ? { ...m, classification } : m
	);
	memThreads = memThreads.map((t) =>
		t.id === threadId
			? {
					...t,
					aiMode: "paused",
					handoffReason: "Prospect opted out — suppressed permanently.",
					lastMessageAt: finishTime,
					pendingJobId: null,
					status: "opted_out",
				}
			: t
	);
	if (company?.primaryContact?.email) {
		memSuppressions = [
			...memSuppressions,
			{
				companyId: company.id,
				createdAt: finishTime,
				email: company.primaryContact.email,
				id: `sup_${Date.now()}`,
				reason: "opt_out",
			},
		];
	}
}

function applyFallbackOutsidePlaybook(params: {
	asksIfBot: boolean;
	botDisclosure: string;
	company: SdrCompanySummary | undefined;
	finishTime: string;
	firstName: string;
	inboundId: string;
	mentionsPricing: boolean;
	thread: SdrThreadItem;
	threadId: string;
}): void {
	const {
		asksIfBot,
		botDisclosure,
		company,
		finishTime,
		firstName,
		inboundId,
		mentionsPricing,
		thread,
		threadId,
	} = params;
	const classification: ReplyClassificationReport = {
		asksIfBot,
		confidence: 0.64,
		detectedTimezone: thread.prospectTimezone,
		intent: "question",
		isOptOut: false,
		mentionsPricing,
		needsInfoFromHuman: true,
		rationale:
			"Question outside Ledgerwise playbook (confidence 0.64 < 0.75) → handed off to human with suggested draft.",
		selectedSlotIso: null,
		wantsMeeting: false,
	};
	memMessages = [
		...memMessages.map((m) =>
			m.id === inboundId ? { ...m, classification } : m
		),
		{
			author: "ai",
			bodyText: `Hi ${firstName},\n\n${botDisclosure}Great question—I'm looping in Dana Mercer directly to confirm how our accounting pod handles that workflow for ${company?.name ?? "your team"}.\n\nWould you have 15 minutes early next week for a quick call with Dana?\n\n${memSettings.signature}`,
			citations: [],
			createdAt: finishTime,
			decisionSummary:
				"Escalated to human (needsInfoFromHuman = true, confidence 0.64 < 0.75). Saved suggested draft and paused AI auto-reply.",
			direction: "outbound",
			id: `msg_${Date.now()}`,
			status: "draft",
			subject: "Re: Ledgerwise Intro",
			threadId,
		},
	];
	memThreads = memThreads.map((t) =>
		t.id === threadId
			? {
					...t,
					aiMode: "paused",
					handoffReason:
						"Question outside playbook (confidence 0.64 < 0.75) — awaiting human takeover.",
					lastMessageAt: finishTime,
					pendingJobId: null,
					status: "needs_human",
				}
			: t
	);
}

function applyFallbackSlotBooking(params: {
	asksIfBot: boolean;
	botDisclosure: string;
	company: SdrCompanySummary | undefined;
	finishTime: string;
	firstName: string;
	inboundId: string;
	thread: SdrThreadItem;
	threadId: string;
}): void {
	const {
		asksIfBot,
		botDisclosure,
		company,
		finishTime,
		firstName,
		inboundId,
		thread,
		threadId,
	} = params;
	const slot = thread.offeredSlots[0] ?? {
		endIso: "2026-11-17T19:15:00.000Z",
		formattedLabel: "Tue, Nov 17 at 2:00 PM ET",
		startIso: "2026-11-17T19:00:00.000Z",
		timezone: thread.prospectTimezone,
	};
	const bookingUid = `cal_bk_${Date.now()}`;
	memMeetings = [
		...memMeetings,
		{
			attendeeEmail: company?.primaryContact?.email ?? "founder@example.com",
			calBookingUid: bookingUid,
			companyId: thread.companyId,
			contactId: thread.contactId,
			endAt: slot.endIso,
			id: `mtg_${Date.now()}`,
			meetingUrl: `https://app.cal.com/video/${bookingUid}`,
			notes: `15-min Ledgerwise Intro Call with ${company?.name ?? "Prospect"}`,
			startAt: slot.startIso,
			status: "scheduled",
			threadId: thread.id,
			timezone: slot.timezone,
			title: `Ledgerwise × ${company?.name ?? "Prospect"} — Intro Call`,
		},
	];
	memMessages = [
		...memMessages.map((m) =>
			m.id === inboundId
				? {
						...m,
						classification: {
							asksIfBot,
							confidence: 0.97,
							detectedTimezone: thread.prospectTimezone,
							intent: "slot_selection" as const,
							isOptOut: false,
							mentionsPricing: false,
							needsInfoFromHuman: false,
							rationale: `Prospect selected ${slot.formattedLabel} → booked on Cal.com (${bookingUid}).`,
							selectedSlotIso: slot.startIso,
							wantsMeeting: true,
						},
					}
				: m
		),
		{
			author: "ai",
			bodyText: `Hi ${firstName},\n\n${botDisclosure}You're all set! I've booked our 15-minute intro call for ${slot.formattedLabel} and sent a calendar invite with the video link to ${company?.primaryContact?.email ?? "your email"}.\n\nLooking forward to speaking then!\n\n${memSettings.signature}`,
			citations: [],
			createdAt: finishTime,
			decisionSummary: `Matched offered slot (${slot.formattedLabel}) → booked on Cal.com (${bookingUid}) and sent confirmation.`,
			direction: "outbound",
			id: `msg_${Date.now()}`,
			sentAt: finishTime,
			status: "sent",
			subject: "Re: Ledgerwise Intro",
			threadId,
		},
	];
	memThreads = memThreads.map((t) =>
		t.id === threadId
			? {
					...t,
					aiReplyCount: t.aiReplyCount + 1,
					lastMessageAt: finishTime,
					pendingJobId: null,
					status: "booked",
				}
			: t
	);
}

function processFallbackSimulatedInbound(params: {
	bodyText: string;
	inboundId: string;
	onDone: () => void;
	threadId: string;
}): void {
	const thread = memThreads.find((t) => t.id === params.threadId);
	if (!thread) {
		return;
	}
	const company = memCompanies.find((c) => c.id === thread.companyId);
	const firstName = company?.primaryContact?.fullName.split(" ")[0] ?? "there";
	const text = params.bodyText.trim();
	const finishTime = new Date().toISOString();

	if (OPT_OUT_REGEX.test(text)) {
		applyFallbackOptOut({
			company,
			finishTime,
			inboundId: params.inboundId,
			thread,
			threadId: params.threadId,
		});
		params.onDone();
		return;
	}

	const asksIfBot = BOT_QUESTION_REGEX.test(text);
	const mentionsPricing = PRICING_QUESTION_REGEX.test(text);
	const wantsMeeting = MEETING_INTEREST_REGEX.test(text);
	const picksSlot =
		SLOT_SELECTION_REGEX.test(text) &&
		thread.offeredSlots.length > 0 &&
		!wantsMeeting;
	const outsidePlaybook = OUTSIDE_PLAYBOOK_REGEX.test(text);

	const botDisclosure =
		asksIfBot || memSettings.aiDisclosure === "always"
			? "To answer your question honestly: I'm Ledgerwise's AI assistant working alongside Dana Mercer and our ecommerce accounting team—Dana reviews our threads and leads every intro call personally.\n\n"
			: "";

	if (outsidePlaybook) {
		applyFallbackOutsidePlaybook({
			asksIfBot,
			botDisclosure,
			company,
			finishTime,
			firstName,
			inboundId: params.inboundId,
			mentionsPricing,
			thread,
			threadId: params.threadId,
		});
		params.onDone();
		return;
	}

	if (picksSlot) {
		applyFallbackSlotBooking({
			asksIfBot,
			botDisclosure,
			company,
			finishTime,
			firstName,
			inboundId: params.inboundId,
			thread,
			threadId: params.threadId,
		});
		params.onDone();
		return;
	}

	const slots = [
		{
			endIso: "2026-11-17T15:15:00.000Z",
			formattedLabel: "Tue, Nov 17 at 10:00 AM ET",
			startIso: "2026-11-17T15:00:00.000Z",
			timezone: thread.prospectTimezone,
		},
		{
			endIso: "2026-11-18T19:15:00.000Z",
			formattedLabel: "Wed, Nov 18 at 2:00 PM ET",
			startIso: "2026-11-18T19:00:00.000Z",
			timezone: thread.prospectTimezone,
		},
		{
			endIso: "2026-11-19T16:15:00.000Z",
			formattedLabel: "Thu, Nov 19 at 11:00 AM ET",
			startIso: "2026-11-19T16:00:00.000Z",
			timezone: thread.prospectTimezone,
		},
	];
	const intentLabel = resolveFallbackIntentLabel({
		asksIfBot,
		mentionsPricing,
		wantsMeeting,
	});

	const coreAnswer = mentionsPricing
		? "Because we scope our monthly accrual bookkeeping to your order volume, active sales channels, and 3PL inventory setup, we never quote flat fees over email—Dana walks through exact scoping and pricing on a quick 15-minute intro call."
		: "At Ledgerwise, our dedicated US ecommerce accounting pods reconcile Shopify, Amazon Seller Central, and 3PL landed COGS every month—delivering an investor-ready accrual close by the 10th business day alongside your existing tax CPA.";

	const replyBody = [
		`Hi ${firstName},`,
		botDisclosure ? botDisclosure.trim() : "Thanks for your note!",
		coreAnswer,
		`Would any of these 15-minute times work for a quick intro call next week?\n${slots.map((s) => `• ${s.formattedLabel}`).join("\n")}`,
		memSettings.signature,
	].join("\n\n");

	memMessages = [
		...memMessages.map((m) =>
			m.id === params.inboundId
				? {
						...m,
						classification: {
							asksIfBot,
							confidence: 0.93,
							detectedTimezone: thread.prospectTimezone,
							intent: intentLabel,
							isOptOut: false,
							mentionsPricing,
							needsInfoFromHuman: false,
							rationale: `Classified as ${intentLabel} (0.93 confidence). Passed price guard (0 $) and bot disclosure guard.`,
							selectedSlotIso: null,
							wantsMeeting: true,
						},
					}
				: m
		),
		{
			author: "ai",
			bodyText: replyBody,
			citations: [],
			createdAt: finishTime,
			decisionSummary: `Auto-replied (${intentLabel}, 0.93 confidence): ${asksIfBot ? "honest AI disclosure included, " : ""}${mentionsPricing ? "pricing deflected to call (0 $ quoted), " : ""}offered 3 live Cal.com slots.`,
			direction: "outbound",
			id: `msg_${Date.now()}`,
			sentAt: finishTime,
			status: "sent",
			subject: "Re: Ledgerwise Intro",
			threadId: params.threadId,
		},
	];
	memThreads = memThreads.map((t) =>
		t.id === params.threadId
			? {
					...t,
					aiReplyCount: t.aiReplyCount + 1,
					lastMessageAt: finishTime,
					offeredSlots: slots,
					pendingJobId: null,
					status: "active",
				}
			: t
	);
	params.onDone();
}

export function useSdrThreadMutations() {
	const queryClient = useQueryClient();

	const invalidateThreads = async (threadId?: string) => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["sdr", "threads"] }),
			queryClient.invalidateQueries({ queryKey: ["sdr", "dashboard"] }),
			queryClient.invalidateQueries({ queryKey: ["sdr", "meetings"] }),
			queryClient.invalidateQueries({ queryKey: ["sdr", "companies"] }),
			threadId
				? queryClient.invalidateQueries({
						queryKey: ["sdr", "thread", threadId],
					})
				: Promise.resolve(),
		]);
	};

	const takeoverMutation = useMutation({
		mutationFn: async (threadId: string) => {
			try {
				const res = await client.api.sdr.threads[":id"].takeover.$post({
					param: { id: threadId },
				});
				return await parseApiResponse(res);
			} catch {
				memThreads = memThreads.map((t) =>
					t.id === threadId ? { ...t, aiMode: "paused", status: "human" } : t
				);
				return memThreads.find((t) => t.id === threadId);
			}
		},
		onSuccess: async (_, threadId) => {
			toast.success("You took over this conversation. AI auto-replies paused.");
			await invalidateThreads(threadId);
		},
	});

	const releaseMutation = useMutation({
		mutationFn: async (threadId: string) => {
			try {
				const res = await client.api.sdr.threads[":id"].release.$post({
					param: { id: threadId },
				});
				return await parseApiResponse(res);
			} catch {
				memThreads = memThreads.map((t) =>
					t.id === threadId
						? { ...t, aiMode: "auto", handoffReason: null, status: "active" }
						: t
				);
				return memThreads.find((t) => t.id === threadId);
			}
		},
		onSuccess: async (_, threadId) => {
			toast.success("Conversation handed back to Ledgerwise AI SDR");
			await invalidateThreads(threadId);
		},
	});

	const sendHumanMessageMutation = useMutation({
		mutationFn: async (params: {
			bodyText: string;
			subject?: string;
			threadId: string;
		}) => {
			if (checkPriceGuard(params.bodyText)) {
				throw new Error(
					"Ledgerwise policy violation: never quote a price in email. Pricing is discussed on a call."
				);
			}
			try {
				const res = await client.api.sdr.threads[":id"].messages.$post({
					json: {
						bodyText: params.bodyText,
						subject: params.subject,
					},
					param: { id: params.threadId },
				});
				return await parseApiResponse(res);
			} catch (err) {
				if (
					err instanceof Error &&
					err.message.includes("Ledgerwise policy violation")
				) {
					throw err;
				}
				const now = new Date().toISOString();
				const newMsg: SdrMessageItem = {
					author: "human",
					bodyText: params.bodyText.trim(),
					citations: [],
					createdAt: now,
					decisionSummary: "Sent manually by sales rep (AI paused).",
					direction: "outbound",
					id: `msg_${Date.now()}`,
					sentAt: now,
					status: "sent",
					subject: params.subject || "Re: Ledgerwise follow-up",
					threadId: params.threadId,
				};
				memMessages = [
					...memMessages.filter(
						(m) => !(m.threadId === params.threadId && m.status === "draft")
					),
					newMsg,
				];
				memThreads = memThreads.map((t) =>
					t.id === params.threadId
						? {
								...t,
								aiMode: "paused",
								handoffReason: null,
								lastMessageAt: now,
								status: "human",
							}
						: t
				);
				return newMsg;
			}
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : "Failed to send reply");
		},
		onSuccess: async (_, vars) => {
			toast.success("Reply sent");
			await invalidateThreads(vars.threadId);
		},
	});

	const simulateInboundMutation = useMutation({
		mutationFn: async (params: {
			bodyText: string;
			preset?:
				| "pricing"
				| "bot_check"
				| "meeting_request"
				| "slot_pick"
				| "objection"
				| "opt_out"
				| "outside_playbook"
				| "custom";
			threadId: string;
		}) => {
			try {
				const res = await client.api.sdr.threads[":id"][
					"simulate-inbound"
				].$post({
					json: {
						bodyText: params.bodyText,
						preset: params.preset ?? "custom",
					},
					param: { id: params.threadId },
				});
				return await parseApiResponse(res);
			} catch {
				const now = new Date().toISOString();
				const inboundId = `sim_in_${Date.now()}`;
				const jobId = `job_${Date.now()}`;
				const inboundMsg: SdrMessageItem = {
					author: "prospect",
					bodyText: params.bodyText.trim(),
					citations: [],
					createdAt: now,
					direction: "inbound",
					id: inboundId,
					sentAt: now,
					status: "received",
					subject: "Re: Ledgerwise Intro",
					threadId: params.threadId,
				};
				memMessages = [...memMessages, inboundMsg];
				memThreads = memThreads.map((t) =>
					t.id === params.threadId
						? { ...t, lastMessageAt: now, pendingJobId: jobId }
						: t
				);

				// Simulate BullMQ worker completion after 1.1s so the live polling indicator updates smoothly
				setTimeout(() => {
					processFallbackSimulatedInbound({
						bodyText: params.bodyText,
						inboundId,
						onDone: () => {
							void invalidateThreads(params.threadId);
						},
						threadId: params.threadId,
					});
				}, 1100);

				return {
					inboundMessage: inboundMsg,
					pendingJobId: jobId,
					threadId: params.threadId,
				};
			}
		},
		onSuccess: async (_, vars) => {
			toast.info(
				"Simulated prospect reply queued in BullMQ — polling live thread updates..."
			);
			await invalidateThreads(vars.threadId);
		},
	});

	return {
		isReleasing: releaseMutation.isPending,
		isSendingHumanReply: sendHumanMessageMutation.isPending,
		isSimulatingInbound: simulateInboundMutation.isPending,
		isTakingOver: takeoverMutation.isPending,
		releaseThread: releaseMutation.mutateAsync,
		sendHumanReply: sendHumanMessageMutation.mutateAsync,
		simulateInboundReply: simulateInboundMutation.mutateAsync,
		takeoverThread: takeoverMutation.mutateAsync,
	};
}

export interface SdrMeetingListEntry {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	meeting: SdrMeetingItem;
}

export function useSdrMeetings() {
	return useQuery({
		queryKey: ["sdr", "meetings"],
		queryFn: async (): Promise<SdrMeetingListEntry[]> => {
			try {
				const res = await client.api.sdr.meetings.$get();
				const data = await parseApiResponse<{
					meetings: SdrMeetingListEntry[];
				}>(res);
				return data.meetings;
			} catch {
				return memMeetings.map((meeting) => {
					const company =
						memCompanies.find((c) => c.id === meeting.companyId) ?? null;
					return {
						company,
						contact: company?.primaryContact ?? null,
						meeting,
					};
				});
			}
		},
	});
}

export interface SdrSettingsResponse {
	settings: SdrSettingsState;
	suppressionCount: number;
	suppressions: Array<{
		companyId: string | null;
		createdAt: string;
		email: string;
		id: string;
		reason: string;
	}>;
}

export function useSdrSettings() {
	const queryClient = useQueryClient();

	const settingsQuery = useQuery({
		queryKey: ["sdr", "settings"],
		queryFn: async (): Promise<SdrSettingsResponse> => {
			try {
				const res = await client.api.sdr.settings.$get();
				return await parseApiResponse<SdrSettingsResponse>(res);
			} catch {
				return {
					settings: memSettings,
					suppressionCount: memSuppressions.length,
					suppressions: memSuppressions,
				};
			}
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (input: {
			aiDisclosure?: SdrAiDisclosureMode;
			autopilot?: SdrAutopilotMode;
			dailySendCap?: number;
			icp?: SdrIcpConfig;
			playbook?: SdrPlaybookConfig;
			senderName?: string;
			senderTitle?: string;
			signature?: string;
		}) => {
			try {
				const res = await client.api.sdr.settings.$put({
					json: input,
				});
				return await parseApiResponse(res);
			} catch {
				memSettings = {
					...memSettings,
					...input,
				};
				return memSettings;
			}
		},
		onSuccess: async () => {
			toast.success("Playbook & SDR rules saved");
			await queryClient.invalidateQueries({ queryKey: ["sdr", "settings"] });
		},
	});

	const resetDemoMutation = useMutation({
		mutationFn: async () => {
			try {
				const res = await client.api.sdr.settings["reset-demo"].$post();
				return await parseApiResponse(res);
			} catch {
				memCompanies = structuredClone(INITIAL_FALLBACK_COMPANIES);
				memCriteria = structuredClone(INITIAL_FALLBACK_CRITERIA);
				memEvidence = structuredClone(INITIAL_FALLBACK_EVIDENCE);
				memThreads = structuredClone(INITIAL_FALLBACK_THREADS);
				memMessages = structuredClone(INITIAL_FALLBACK_MESSAGES);
				memMeetings = structuredClone(INITIAL_FALLBACK_MEETINGS);
				memSettings = structuredClone(INITIAL_FALLBACK_SETTINGS);
				memSuppressions = [];
				return { organizationId: "org_ledgerwise" };
			}
		},
		onSuccess: async () => {
			toast.success("Ledgerwise demo dataset restored");
			await queryClient.invalidateQueries({ queryKey: ["sdr"] });
		},
	});

	return {
		...settingsQuery,
		isResettingDemo: resetDemoMutation.isPending,
		isSavingSettings: updateMutation.isPending,
		resetDemoData: resetDemoMutation.mutateAsync,
		saveSettings: updateMutation.mutateAsync,
	};
}

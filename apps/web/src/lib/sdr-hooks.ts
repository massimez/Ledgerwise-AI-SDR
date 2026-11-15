"use client";

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	type DiscoveryNicheId,
	detectOutboundPriceViolation,
} from "@workspace/ai-core/contracts";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { client, parseApiResponse } from "./api-client";
import type {
	CompanyStatus,
	CompanyTier,
	DiscoverLeadsResponse,
	SdrAiDisclosureMode,
	SdrAutopilotMode,
	SdrCompaniesPage,
	SdrCompanySort,
	SdrCompanySummary,
	SdrCriterionItem,
	SdrDashboardSummary,
	SdrDiscoverySignalPreset,
	SdrEvidenceItem,
	SdrIcpConfig,
	SdrMeetingItem,
	SdrMessageItem,
	SdrPlaybookConfig,
	SdrResearchRunItem,
	SdrSettingsState,
	SdrThreadItem,
	ThreadStatus,
} from "./sdr-types";

export function useSdrDashboard() {
	return useQuery({
		queryKey: ["sdr", "dashboard"],
		queryFn: async (): Promise<SdrDashboardSummary> => {
			const res = await client.api.sdr.dashboard.$get();
			return await parseApiResponse<SdrDashboardSummary>(res);
		},
	});
}

export interface SdrCompaniesFilterParams {
	includeHidden?: boolean;
	q?: string;
	signal?: string;
	sort?: SdrCompanySort;
	status?: CompanyStatus;
	tier?: CompanyTier;
}

export function useSdrCompanies(filters?: SdrCompaniesFilterParams) {
	return useQuery({
		queryKey: ["sdr", "companies", filters ?? {}],
		queryFn: async (): Promise<SdrCompanySummary[]> => {
			const res = await client.api.sdr.companies.$get({
				query: {
					includeHidden: filters?.includeHidden ? "true" : "false",
					limit: "50",
					offset: "0",
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
		},
	});
}

export function useInfiniteSdrCompanies(
	filters?: SdrCompaniesFilterParams & { limit?: number }
) {
	const pageSize = filters?.limit ?? 10;
	return useInfiniteQuery({
		queryKey: ["sdr", "companies", "infinite", pageSize, filters ?? {}],
		initialPageParam: 0,
		queryFn: async ({ pageParam }): Promise<SdrCompaniesPage> => {
			const res = await client.api.sdr.companies.$get({
				query: {
					includeHidden: filters?.includeHidden ? "true" : "false",
					limit: String(pageSize),
					offset: String(pageParam),
					q: filters?.q,
					signal: filters?.signal,
					sort: filters?.sort ?? "score_desc",
					status: filters?.status,
					tier: filters?.tier,
				},
			});
			return parseApiResponse<SdrCompaniesPage>(res);
		},
		getNextPageParam: (lastPage) =>
			lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
	});
}

export function useToggleCompanyHiddenMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { companyId: string; hidden: boolean }) => {
			const res = await client.api.sdr.companies[":id"].$patch({
				param: { id: input.companyId },
				json: { hidden: input.hidden },
			});
			return parseApiResponse<{ company: SdrCompanySummary }>(res);
		},
		onSuccess: (_data, variables) => {
			toast.success(
				variables.hidden
					? "Company hidden from active list"
					: "Company restored to active list"
			);
			void queryClient.invalidateQueries({ queryKey: ["sdr"] });
		},
		onError: (err: Error) => {
			toast.error(err.message);
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
			const res = await client.api.sdr.companies[":id"].$get({
				param: { id: companyId },
			});
			return await parseApiResponse<SdrCompanyDetailData>(res);
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
			const res = await client.api.sdr.review.$get();
			const data = await parseApiResponse<{ items: SdrReviewQueueItem[] }>(res);
			return data.items;
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
			citedSpans?: string[];
			messageId: string;
			subject?: string;
		}) => {
			if (
				(params.bodyText || params.subject) &&
				detectOutboundPriceViolation(
					`${params.subject ?? ""}\n${params.bodyText ?? ""}`,
					params.citedSpans
				) !== null
			) {
				throw new Error(
					"Ledgerwise policy violation: outbound email must never quote a dollar price or monthly fee. Pricing is discussed on a call."
				);
			}

			const res = await client.api.sdr.review[":messageId"].approve.$post({
				json: {
					bodyText: params.bodyText,
					subject: params.subject,
				},
				param: { messageId: params.messageId },
			});
			return await parseApiResponse(res);
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
			const res = await client.api.sdr.review[":messageId"].reject.$post({
				json: { reason: params.reason },
				param: { messageId: params.messageId },
			});
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to reject draft"
			);
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
			const res = await client.api.sdr.threads.$get({
				query: statusFilter ? { status: statusFilter } : {},
			});
			const data = await parseApiResponse<{
				threads: SdrThreadListEntry[];
			}>(res);
			return data.threads;
		},
		// Keep sidebar status badges fresh while any thread has a pending background evaluation
		refetchInterval: (query) => {
			const hasPending = query.state.data?.some((entry) =>
				Boolean(entry.thread.pendingJobId)
			);
			return hasPending ? 2000 : false;
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
	const queryClient = useQueryClient();
	const query = useQuery({
		enabled: Boolean(threadId),
		queryKey: ["sdr", "thread", threadId],
		queryFn: async (): Promise<SdrThreadDetailData> => {
			if (!threadId) {
				throw new Error("Thread ID required");
			}
			const res = await client.api.sdr.threads[":id"].$get({
				param: { id: threadId },
			});
			return await parseApiResponse<SdrThreadDetailData>(res);
		},
		// Automatically poll every 1500ms while a simulated reply or background job is active on the thread
		refetchInterval: (q) => {
			const pendingJobId = q.state.data?.thread?.pendingJobId;
			return pendingJobId ? 1500 : false;
		},
	});

	const pendingJobId = query.data?.thread?.pendingJobId ?? null;
	const prevPendingJobIdRef = useRef<string | null>(null);

	useEffect(() => {
		const prev = prevPendingJobIdRef.current;
		prevPendingJobIdRef.current = pendingJobId;
		if (prev && !pendingJobId) {
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: ["sdr", "threads"] }),
				queryClient.invalidateQueries({ queryKey: ["sdr", "dashboard"] }),
				queryClient.invalidateQueries({ queryKey: ["sdr", "meetings"] }),
				queryClient.invalidateQueries({ queryKey: ["sdr", "companies"] }),
			]);
		}
	}, [pendingJobId, queryClient]);

	return query;
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
			const res = await client.api.sdr.threads[":id"].takeover.$post({
				param: { id: threadId },
			});
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to take over thread"
			);
		},
		onSuccess: async (_, threadId) => {
			toast.success("You took over this conversation. AI auto-replies paused.");
			await invalidateThreads(threadId);
		},
	});

	const releaseMutation = useMutation({
		mutationFn: async (threadId: string) => {
			const res = await client.api.sdr.threads[":id"].release.$post({
				param: { id: threadId },
			});
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to release thread"
			);
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
			if (
				detectOutboundPriceViolation(
					`${params.subject ?? ""}\n${params.bodyText}`
				) !== null
			) {
				throw new Error(
					"Ledgerwise policy violation: never quote a price in email. Pricing is discussed on a call."
				);
			}
			const res = await client.api.sdr.threads[":id"].messages.$post({
				json: {
					bodyText: params.bodyText,
					subject: params.subject,
				},
				param: { id: params.threadId },
			});
			return await parseApiResponse(res);
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
		mutationFn: async (params: { bodyText: string; threadId: string }) => {
			const res = await client.api.sdr.threads[":id"]["simulate-inbound"].$post(
				{
					json: {
						bodyText: params.bodyText,
					},
					param: { id: params.threadId },
				}
			);
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to simulate inbound reply"
			);
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
			const res = await client.api.sdr.meetings.$get();
			const data = await parseApiResponse<{
				meetings: SdrMeetingListEntry[];
			}>(res);
			return data.meetings;
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
			const res = await client.api.sdr.settings.$get();
			return await parseApiResponse<SdrSettingsResponse>(res);
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
			const res = await client.api.sdr.settings.$put({
				json: input,
			});
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to save SDR settings"
			);
		},
		onSuccess: async () => {
			toast.success("Playbook & SDR rules saved");
			await queryClient.invalidateQueries({ queryKey: ["sdr", "settings"] });
		},
	});

	const resetDemoMutation = useMutation({
		mutationFn: async () => {
			const res = await client.api.sdr.settings["reset-demo"].$post();
			return await parseApiResponse(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error ? err.message : "Failed to restore demo dataset"
			);
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

export function useSdrResearchRuns() {
	return useQuery({
		queryKey: ["sdr", "research-runs"],
		queryFn: async (): Promise<SdrResearchRunItem[]> => {
			const res = await client.api.sdr.research.runs.$get();
			const data = await parseApiResponse<{ runs: SdrResearchRunItem[] }>(res);
			return data.runs;
		},
		refetchInterval: (query) => {
			const hasActiveRun = query.state.data?.some(
				(run) => run.status === "queued" || run.status === "running"
			);
			return hasActiveRun ? 1500 : false;
		},
	});
}

export function useDiscoverLeadsMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: {
			keyword?: string;
			limit: number;
			niche?: DiscoveryNicheId;
			signalPreset: SdrDiscoverySignalPreset;
		}): Promise<DiscoverLeadsResponse> => {
			const res = await client.api.sdr.research.runs.$post({
				json: {
					keyword: input.keyword?.trim() || undefined,
					limit: input.limit,
					niche: input.niche,
					signalPreset: input.signalPreset,
				},
			});
			return await parseApiResponse<DiscoverLeadsResponse>(res);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: "Failed to start lead discovery batch"
			);
		},
		onSuccess: async (result) => {
			queryClient.setQueryData<SdrResearchRunItem[]>(
				["sdr", "research-runs"],
				(prev = []) => [
					result.run,
					...prev.filter((run) => run.id !== result.run.id),
				]
			);
			if (result.queued) {
				toast.info("Lead discovery started — researching & scoring new brands");
			} else {
				toast.error(
					result.run.error ?? "Worker queue unavailable to run lead discovery"
				);
			}
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["sdr", "research-runs"] }),
				queryClient.invalidateQueries({ queryKey: ["sdr", "companies"] }),
			]);
		},
	});
}

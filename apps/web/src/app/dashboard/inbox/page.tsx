"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	AlertTriangle,
	Bot,
	CalendarCheck,
	FlaskConical,
	Hand,
	Loader2,
	Lock,
	Send,
	Sparkles,
	User,
	UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
	type SdrThreadListEntry,
	useSdrThreadDetail,
	useSdrThreadMutations,
	useSdrThreads,
} from "@/lib/sdr-hooks";
import type {
	SdrCompanySummary,
	SdrMeetingItem,
	SdrMessageItem,
	SdrThreadItem,
	ThreadStatus,
} from "@/lib/sdr-types";
import { ThreadStateBadge, TierBadge } from "../_components/sdr-badges";
import { SimulateReplyDialog } from "./_components/simulate-reply-dialog";

const WHITESPACE_SPLIT_REGEX = /\s+/u;

function getMessageCardClasses(msg: SdrMessageItem): string {
	if (msg.direction === "inbound") {
		return "border-border/70 bg-background/60";
	}
	if (msg.author === "ai") {
		return "border-border/70 bg-muted/20";
	}
	return "border-indigo-500/25 bg-indigo-500/5";
}

function buildSafeSuggestedHumanReply(options: {
	companyName: string;
	contactName: string;
	messages: SdrMessageItem[];
}): string {
	const firstName =
		options.contactName.trim().split(WHITESPACE_SPLIT_REGEX)[0] || "there";
	const latestInbound = [...options.messages]
		.reverse()
		.find((msg) => msg.direction === "inbound");
	const intent = latestInbound?.classification?.intent;

	if (latestInbound?.classification?.mentionsPricing) {
		return `Hi ${firstName},\n\nThanks for asking about pricing for ${options.companyName}. Because our monthly bookkeeping scope depends on order volume, active channels, and inventory or 3PL workflows, we share exact numbers live on a brief 15-minute intro call.\n\nWould Tuesday or Thursday work for a quick walkthrough?`;
	}

	if (intent === "human_request") {
		return `Hi ${firstName},\n\nThanks for the note—I'm stepping in directly from our sales and accounting team to answer your questions for ${options.companyName}.\n\nDo you have 15 minutes this week for a brief call to review the specifics?`;
	}

	if (intent === "referral") {
		return `Hi ${firstName},\n\nAppreciate you connecting us with the right finance lead at ${options.companyName}. Feel free to reply-all with them on this thread or share a couple of times that work for a quick intro call.`;
	}

	return `Hi ${firstName},\n\nThanks for following up—I'd be glad to walk through how Ledgerwise handles multi-channel Shopify and Amazon accrual closes and landed COGS for ${options.companyName}.\n\nDo you have 15 minutes this week for a quick intro call?`;
}

function SenderLabel({
	contactName,
	msg,
}: {
	contactName?: string;
	msg: SdrMessageItem;
}) {
	if (msg.direction === "inbound") {
		return (
			<span className="text-foreground inline-flex items-center gap-1.5 font-semibold">
				<User className="text-muted-foreground h-3.5 w-3.5" />
				<span>{contactName ?? "Prospect"}</span>
			</span>
		);
	}
	if (msg.author === "ai") {
		return (
			<span className="text-foreground inline-flex items-center gap-1.5 font-semibold">
				<Bot className="text-primary h-3.5 w-3.5" />
				<span>Ledgerwise AI</span>
			</span>
		);
	}
	return (
		<span className="text-foreground inline-flex items-center gap-1.5 font-semibold">
			<UserCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
			<span>Sales Rep (You)</span>
		</span>
	);
}

function formatMessageFootnote(msg: SdrMessageItem): string | null {
	if (msg.decisionSummary) {
		return msg.decisionSummary;
	}
	const cls = msg.classification;
	if (!cls) {
		return null;
	}
	const parts = [
		`Intent: ${cls.intent.replaceAll("_", " ")} (${Math.round(cls.confidence * 100)}%)`,
	];
	if (cls.mentionsPricing) {
		parts.push("Pricing question (deferred to call)");
	}
	if (cls.asksIfBot) {
		parts.push("Bot inquiry (disclosure verified)");
	}
	return parts.join(" · ");
}

function MessageCard({
	contactName,
	isFirst,
	msg,
}: {
	contactName?: string;
	isFirst: boolean;
	msg: SdrMessageItem;
}) {
	const footnote = formatMessageFootnote(msg);
	return (
		<div
			className={cn(
				"space-y-2.5 rounded-xl border p-4 text-xs",
				getMessageCardClasses(msg)
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<SenderLabel contactName={contactName} msg={msg} />
					{isFirst && msg.subject ? (
						<>
							<span className="text-muted-foreground">·</span>
							<span className="text-muted-foreground truncate">
								{msg.subject}
							</span>
						</>
					) : null}
				</div>

				<span className="text-muted-foreground shrink-0 font-mono text-[11px]">
					{new Date(msg.createdAt).toLocaleString([], {
						dateStyle: "short",
						timeStyle: "short",
					})}
				</span>
			</div>

			<div className="text-foreground font-sans text-sm leading-relaxed whitespace-pre-wrap">
				{msg.bodyText}
			</div>

			{footnote ? (
				<div className="border-border/50 text-muted-foreground border-t pt-2 text-[11px]">
					{footnote}
				</div>
			) : null}
		</div>
	);
}

function ThreadListPane({
	activeThreadId,
	entries,
	errorMessage,
	isError,
	isLoading,
	onRetry,
	onSelect,
}: {
	activeThreadId: string | null;
	entries: SdrThreadListEntry[];
	errorMessage?: string;
	isError: boolean;
	isLoading: boolean;
	onRetry: () => void;
	onSelect: (id: string) => void;
}) {
	if (isLoading) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				Loading threads…
			</div>
		);
	}
	if (isError) {
		return (
			<div className="border-border/70 bg-card space-y-3 rounded-xl border p-6 text-center text-sm">
				<p className="text-rose-600 dark:text-rose-400">
					{errorMessage ?? "Failed to load conversation threads."}
				</p>
				<Button onClick={onRetry} size="sm" type="button" variant="outline">
					Retry
				</Button>
			</div>
		);
	}
	if (entries.length === 0) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				No threads match this filter.
			</div>
		);
	}
	return (
		<div className="divide-border/70 border-border/70 bg-card divide-y overflow-y-auto rounded-xl border lg:max-h-full">
			{entries.map((entry) => {
				const isSelected = entry.thread.id === activeThreadId;
				return (
					<button
						className={cn(
							"w-full px-4 py-3.5 text-left transition-colors",
							isSelected
								? "border-l-primary bg-muted/50 border-l-2"
								: "hover:bg-muted/25"
						)}
						key={entry.thread.id}
						onClick={() => onSelect(entry.thread.id)}
						type="button"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="text-foreground truncate text-sm font-semibold">
								{entry.company?.name ?? "Prospect"}
							</span>
							{entry.thread.pendingJobId ? (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
									<Loader2 className="h-3 w-3 animate-spin" />
									<span>AI working</span>
								</span>
							) : (
								<ThreadStateBadge status={entry.thread.status} />
							)}
						</div>
						<div className="text-muted-foreground mt-1 truncate text-xs">
							{entry.contact?.fullName ?? "Founder"} ·{" "}
							{entry.latestMessage?.subject ?? "Ledgerwise Intro"}
						</div>
					</button>
				);
			})}
		</div>
	);
}

function TakeoverControlButton({
	aiMode,
	isOptedOut,
	isReleasing,
	isTakingOver,
	onRelease,
	onTakeover,
}: {
	aiMode: SdrThreadItem["aiMode"];
	isOptedOut: boolean;
	isReleasing: boolean;
	isTakingOver: boolean;
	onRelease: () => void;
	onTakeover: () => void;
}) {
	if (isOptedOut) {
		return null;
	}
	if (aiMode === "auto") {
		return (
			<Button
				disabled={isTakingOver}
				onClick={onTakeover}
				size="sm"
				type="button"
				variant="outline"
			>
				<Hand className="h-3.5 w-3.5" />
				<span>Take Over from AI</span>
			</Button>
		);
	}
	return (
		<Button
			disabled={isReleasing}
			onClick={onRelease}
			size="sm"
			type="button"
			variant="outline"
		>
			<Bot className="h-3.5 w-3.5" />
			<span>Hand Back to AI</span>
		</Button>
	);
}

function ThreadStatusBanners({
	contactEmail,
	isOptedOut,
	isPollingJob,
	meetings,
	thread,
}: {
	contactEmail?: string | null;
	isOptedOut: boolean;
	isPollingJob: boolean;
	meetings: SdrMeetingItem[];
	thread: SdrThreadItem;
}) {
	return (
		<>
			{isPollingJob ? (
				<div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-300" />
					<span>AI is evaluating inbound reply and running safety guards…</span>
				</div>
			) : null}

			{thread.status === "needs_human" ? (
				<div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-900 dark:text-rose-200">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
					<div>
						<span className="font-semibold">Escalated to you: </span>
						<span>
							{thread.handoffReason ??
								"Question outside playbook or below 75% confidence."}
						</span>
					</div>
				</div>
			) : null}

			{isOptedOut ? (
				<div className="border-border bg-muted/60 text-muted-foreground flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs">
					<Lock className="text-foreground h-3.5 w-3.5 shrink-0" />
					<span>
						<strong className="text-foreground">Opted out:</strong>{" "}
						{contactEmail} is suppressed; outbound emails are blocked.
					</span>
				</div>
			) : null}

			{meetings.length > 0 ? (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
					<div className="flex items-center gap-2">
						<CalendarCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
						<span>
							<strong className="font-semibold">Call Booked:</strong>{" "}
							{new Date(meetings[0]?.startAt ?? "").toLocaleString([], {
								dateStyle: "medium",
								timeStyle: "short",
							})}{" "}
							({meetings[0]?.timezone})
						</span>
					</div>
					<Link className="font-medium underline" href="/dashboard/meetings">
						View call →
					</Link>
				</div>
			) : null}
		</>
	);
}

function InboxThreadInspector({
	company,
	contact,
	meetings,
	messages,
	thread,
}: {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	meetings: SdrMeetingItem[];
	messages: SdrMessageItem[];
	thread: SdrThreadItem;
}) {
	const {
		takeoverThread,
		releaseThread,
		sendHumanReply,
		isTakingOver,
		isReleasing,
		isSendingHumanReply,
	} = useSdrThreadMutations();

	const [humanReplyText, setHumanReplyText] = useState("");
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const scrollBottomRef = useRef<HTMLDivElement>(null);
	const prevThreadIdRef = useRef<string | null>(null);
	const prevMessageCountRef = useRef(0);
	const prevLastMessageIdRef = useRef<string | null>(null);

	const isOptedOut = thread.status === "opted_out";
	const isPollingJob = Boolean(thread.pendingJobId);
	const lastMessageId = messages.at(-1)?.id ?? null;

	useEffect(() => {
		const isNewThread = prevThreadIdRef.current !== thread.id;
		const hasNewMessage =
			!isNewThread &&
			(messages.length > prevMessageCountRef.current ||
				lastMessageId !== prevLastMessageIdRef.current);

		prevThreadIdRef.current = thread.id;
		prevMessageCountRef.current = messages.length;
		prevLastMessageIdRef.current = lastMessageId;

		if (!(isNewThread || hasNewMessage)) {
			return;
		}

		const prefersReduced =
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const behavior: ScrollBehavior =
			isNewThread || prefersReduced ? "auto" : "smooth";

		const container = scrollContainerRef.current;
		if (container && container.scrollHeight > container.clientHeight) {
			container.scrollTo({
				behavior,
				top: container.scrollHeight,
			});
			return;
		}

		if (hasNewMessage) {
			scrollBottomRef.current?.scrollIntoView({
				behavior,
				block: "end",
			});
		}
	}, [thread.id, messages.length, lastMessageId]);

	const handleSendHumanReply = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!humanReplyText.trim()) {
			return;
		}
		try {
			await sendHumanReply({
				bodyText: humanReplyText.trim(),
				threadId: thread.id,
			});
			setHumanReplyText("");
		} catch {
			// Surfaced to user via mutation onError toast
		}
	};

	return (
		<div className="border-border/70 bg-card flex flex-col overflow-hidden rounded-xl border lg:h-full lg:min-h-0">
			{/* Thread Top Bar */}
			<div className="border-border/70 flex shrink-0 flex-col justify-between gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center">
				<div className="min-w-0 space-y-0.5">
					<div className="flex flex-wrap items-center gap-2">
						{company ? (
							<Link
								className="text-foreground hover:text-primary text-base font-semibold transition-colors hover:underline"
								href={`/dashboard/companies?companyId=${company.id}`}
							>
								{company.name}
							</Link>
						) : (
							<h2 className="text-foreground text-base font-semibold">
								Prospect
							</h2>
						)}
						{company ? (
							<TierBadge score={company.score} tier={company.tier} />
						) : null}
					</div>
					<div className="text-muted-foreground truncate text-xs">
						<span className="text-foreground font-medium">
							{contact?.fullName}
						</span>
						{contact?.title ? ` (${contact.title})` : null} ·{" "}
						<span className="font-mono">{contact?.email}</span>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<TakeoverControlButton
						aiMode={thread.aiMode}
						isOptedOut={isOptedOut}
						isReleasing={isReleasing}
						isTakingOver={isTakingOver}
						onRelease={() =>
							void releaseThread(thread.id).catch(() => undefined)
						}
						onTakeover={() =>
							void takeoverThread(thread.id).catch(() => undefined)
						}
					/>
				</div>
			</div>

			{/* Pinned Status Banners */}
			{isPollingJob ||
			thread.status === "needs_human" ||
			isOptedOut ||
			meetings.length > 0 ? (
				<div className="border-border/50 shrink-0 space-y-2 border-b px-5 py-3">
					<ThreadStatusBanners
						contactEmail={contact?.email}
						isOptedOut={isOptedOut}
						isPollingJob={isPollingJob}
						meetings={meetings}
						thread={thread}
					/>
				</div>
			) : null}

			{/* Scrollable Chat Area */}
			<div
				className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
				ref={scrollContainerRef}
			>
				{/* Conversation Message Timeline */}
				<div className="space-y-3">
					{messages.map((msg, index) => (
						<MessageCard
							contactName={contact?.fullName}
							isFirst={index === 0}
							key={msg.id}
							msg={msg}
						/>
					))}
				</div>
				<div ref={scrollBottomRef} />
			</div>

			{/* Human Reply Composer */}
			{isOptedOut ? null : (
				<form
					className="border-border/70 bg-card shrink-0 space-y-2 border-t px-5 py-3.5"
					onSubmit={handleSendHumanReply}
				>
					<div className="flex items-center justify-between">
						<label
							className="text-foreground text-xs font-semibold"
							htmlFor="human-reply-textarea"
						>
							Reply to {contact?.fullName ?? "Prospect"}
						</label>
						<Button
							onClick={() =>
								setHumanReplyText(
									buildSafeSuggestedHumanReply({
										companyName: company?.name ?? "your brand",
										contactName: contact?.fullName ?? "there",
										messages,
									})
								)
							}
							size="sm"
							type="button"
							variant="ghost"
						>
							<Sparkles className="h-3.5 w-3.5" />
							<span>Suggest Draft</span>
						</Button>
					</div>
					<textarea
						className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border p-2.5 text-sm focus:outline-none"
						id="human-reply-textarea"
						onChange={(e) => setHumanReplyText(e.target.value)}
						placeholder={`Write a reply to ${contact?.fullName ?? "the prospect"} (pricing is shared on the call)…`}
						rows={2}
						value={humanReplyText}
					/>
					<div className="flex justify-end">
						<Button
							disabled={isSendingHumanReply || !humanReplyText.trim()}
							size="sm"
							type="submit"
							variant="primary"
						>
							<Send className="h-3.5 w-3.5" />
							<span>{isSendingHumanReply ? "Sending…" : "Send Reply"}</span>
						</Button>
					</div>
				</form>
			)}
		</div>
	);
}

function InboxPageContent() {
	const searchParams = useSearchParams();
	const initialThreadId = searchParams.get("threadId");
	const initialStatusFilter = searchParams.get("status") as ThreadStatus | null;

	const [statusFilter, setStatusFilter] = useState<ThreadStatus | "all">(
		initialStatusFilter ?? "all"
	);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
		initialThreadId
	);
	const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);

	const { simulateInboundReply, isSimulatingInbound } = useSdrThreadMutations();

	const {
		data: entries = [],
		error: threadsError,
		isError: isThreadsError,
		isLoading,
		refetch: refetchThreads,
	} = useSdrThreads(statusFilter === "all" ? undefined : statusFilter);

	const activeThreadId = useMemo(() => {
		if (
			selectedThreadId &&
			entries.some((item) => item.thread.id === selectedThreadId)
		) {
			return selectedThreadId;
		}
		return entries[0]?.thread.id ?? null;
	}, [selectedThreadId, entries]);

	const { data: detail } = useSdrThreadDetail(activeThreadId);

	return (
		<div className="mx-auto max-w-6xl space-y-4 p-5 sm:p-6 lg:flex lg:h-[calc(100dvh-6.75rem)] lg:flex-col lg:space-y-4 lg:overflow-hidden">
			{/* Page Header & Filters */}
			<div className="shrink-0 space-y-3">
				<div className="border-border/70 flex flex-col justify-between gap-3 border-b pb-3.5 sm:flex-row sm:items-center">
					<div className="min-w-0 flex-1 space-y-0.5">
						<h1 className="text-foreground text-2xl font-bold tracking-tight">
							Conversation Inbox
						</h1>
						<p className="text-muted-foreground max-w-2xl text-sm">
							Monitor autonomous AI replies, step into escalated threads, or
							simulate inbound prospect messages.
						</p>
					</div>

					<Button
						className="shrink-0"
						disabled={!detail}
						onClick={() => setIsSimulatorOpen(true)}
						size="sm"
						type="button"
						variant="outline"
					>
						<FlaskConical className="h-3.5 w-3.5" />
						<span>Simulate Reply</span>
					</Button>
				</div>

				{/* State Filter Pills */}
				<div className="flex flex-wrap items-center gap-1.5">
					{(
						[
							{ key: "all", label: "All" },
							{ key: "needs_human", label: "Needs You" },
							{ key: "active", label: "AI Handling" },
							{ key: "human", label: "You're Handling" },
							{ key: "booked", label: "Call Booked" },
							{ key: "opted_out", label: "Opted Out" },
						] as const
					).map((tab) => (
						<button
							className={cn(
								"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
								statusFilter === tab.key
									? "border-primary bg-primary/10 text-foreground font-semibold"
									: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
							)}
							key={tab.key}
							onClick={() => setStatusFilter(tab.key)}
							type="button"
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Main Split View */}
			<div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-12">
				<div className="min-w-0 lg:col-span-4 lg:min-h-0">
					<ThreadListPane
						activeThreadId={activeThreadId}
						entries={entries}
						errorMessage={
							threadsError instanceof Error ? threadsError.message : undefined
						}
						isError={isThreadsError}
						isLoading={isLoading}
						onRetry={() => void refetchThreads()}
						onSelect={setSelectedThreadId}
					/>
				</div>

				<div className="min-w-0 lg:col-span-8 lg:min-h-0">
					{detail ? (
						<InboxThreadInspector
							company={detail.company as SdrCompanySummary | null}
							contact={detail.contact as SdrCompanySummary["primaryContact"]}
							key={detail.thread.id}
							meetings={detail.meetings as SdrMeetingItem[]}
							messages={detail.messages as SdrMessageItem[]}
							thread={detail.thread as SdrThreadItem}
						/>
					) : (
						<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
							Select a thread on the left to inspect the conversation.
						</div>
					)}
				</div>
			</div>

			<SimulateReplyDialog
				companyName={detail?.company?.name}
				contactEmail={detail?.contact?.email}
				contactName={detail?.contact?.fullName}
				isSubmitting={isSimulatingInbound}
				onOpenChange={setIsSimulatorOpen}
				onSubmit={async (bodyText) => {
					if (!detail) {
						return;
					}
					await simulateInboundReply({
						bodyText,
						threadId: detail.thread.id,
					});
				}}
				open={isSimulatorOpen && Boolean(detail)}
			/>
		</div>
	);
}

export default function InboxPage() {
	return (
		<Suspense
			fallback={
				<div className="text-muted-foreground mx-auto max-w-6xl p-8 text-sm">
					Loading inbox…
				</div>
			}
		>
			<InboxPageContent />
		</Suspense>
	);
}

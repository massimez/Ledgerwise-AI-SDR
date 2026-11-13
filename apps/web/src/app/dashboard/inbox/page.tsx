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
	ShieldCheck,
	Sparkles,
	UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import type {
	SdrCompanySummary,
	SdrMeetingItem,
	SdrMessageItem,
	SdrThreadItem,
	ThreadStatus,
} from "@/lib/sdr-fallback-data";
import {
	useSdrThreadDetail,
	useSdrThreadMutations,
	useSdrThreads,
} from "@/lib/sdr-hooks";
import { ThreadStateBadge, TierBadge } from "../_components/sdr-badges";

const WHITESPACE_SPLIT_REGEX = /\s+/u;

const SIMULATOR_PRESETS = [
	{
		bodyText:
			"Sounds relevant! Quick question — are you an AI bot? Also, how much do you charge per month for a Shopify + Amazon brand?",
		description:
			"Tests honest bot disclosure (when_asked) + strict zero-pricing guard + Cal.com slot offer.",
		label: "Ask Pricing + 'Are you a bot?'",
		preset: "pricing" as const,
	},
	{
		bodyText:
			"We're actually struggling with our 3PL inventory and Shopify payout reconciliation right now. What times do you have open next week?",
		description:
			"Tests high-confidence interest classification and timezone-aware Cal.com slot proposal.",
		label: "Interested · Ask for Call Times",
		preset: "meeting_request" as const,
	},
	{
		bodyText:
			"2:00 PM works great for me — let's lock that time in on the calendar.",
		description:
			"Tests slot confirmation, automatic meeting booking, and transition to Booked state.",
		label: "Confirm Time Slot (Books Call)",
		preset: "slot_pick" as const,
	},
	{
		bodyText:
			"Can your team file international VAT registration in Germany and handle GAAP certified audit opinions?",
		description:
			"Tests out-of-playbook question detection → pauses AI and escalates thread to Needs You.",
		label: "Out-of-Playbook Question (Escalates)",
		preset: "outside_playbook" as const,
	},
	{
		bodyText:
			"We're all set internally — please unsubscribe me and remove me from your list.",
		description:
			"Tests hard opt-out regex → adds email to suppressions table and permanently locks thread.",
		label: "Opt-Out / 'Not Interested'",
		preset: "opt_out" as const,
	},
] as const;

interface ThreadListEntry {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	latestMessage: SdrMessageItem | null;
	messageCount: number;
	thread: SdrThreadItem;
}

function getMessageCardClasses(msg: SdrMessageItem): string {
	if (msg.direction === "inbound") {
		return "border-border bg-background/80";
	}
	if (msg.author === "ai") {
		return "border-primary/25 bg-primary/5";
	}
	return "border-indigo-500/25 bg-indigo-500/5";
}

function getSenderBadgeClasses(msg: SdrMessageItem): string {
	if (msg.direction === "inbound") {
		return "bg-muted text-foreground";
	}
	if (msg.author === "ai") {
		return "bg-primary/15 text-primary";
	}
	return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
}

function getConfidenceTierLabel(confidence: number): {
	className: string;
	label: string;
} {
	if (confidence >= 0.85) {
		return {
			className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
			label: "High",
		};
	}
	if (confidence >= 0.75) {
		return {
			className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
			label: "Medium",
		};
	}
	return {
		className: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
		label: "Low (<75%)",
	};
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

function SenderBadgeContent({ msg }: { msg: SdrMessageItem }) {
	if (msg.direction === "inbound") {
		return <span>Prospect Inbound</span>;
	}
	if (msg.author === "ai") {
		return (
			<>
				<Bot className="h-3 w-3" />
				<span>Ledgerwise AI SDR</span>
			</>
		);
	}
	return (
		<>
			<UserCheck className="h-3 w-3" />
			<span>Human Representative</span>
		</>
	);
}

function MessageCard({ msg }: { msg: SdrMessageItem }) {
	const cls = msg.classification;
	return (
		<div
			className={cn(
				"rounded-xl border p-4 text-xs",
				getMessageCardClasses(msg)
			)}
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase",
							getSenderBadgeClasses(msg)
						)}
					>
						<SenderBadgeContent msg={msg} />
					</span>
					<span className="text-foreground font-medium">{msg.subject}</span>
				</div>

				<div className="text-muted-foreground flex items-center gap-2 font-mono text-[11px]">
					<span>Status: {msg.status}</span>
					<span>·</span>
					<span>
						{new Date(msg.createdAt).toLocaleString([], {
							dateStyle: "short",
							timeStyle: "short",
						})}
					</span>
				</div>
			</div>

			<div className="text-foreground font-sans text-sm leading-relaxed whitespace-pre-wrap">
				{msg.bodyText}
			</div>

			{msg.decisionSummary ? (
				<div className="bg-muted/60 text-muted-foreground mt-2.5 rounded-md px-2.5 py-1.5 font-mono text-[11px]">
					AI Decision: {msg.decisionSummary}
				</div>
			) : null}

			{cls ? (
				<div className="border-border/60 mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5 font-mono text-[11px]">
					<span className="bg-muted text-foreground rounded px-2 py-0.5">
						intent: {cls.intent} ({Math.round(cls.confidence * 100)}%)
					</span>
					<span
						className={cn(
							"rounded px-2 py-0.5",
							getConfidenceTierLabel(cls.confidence).className
						)}
					>
						confidence: {getConfidenceTierLabel(cls.confidence).label}
					</span>
					{cls.detectedTimezone ? (
						<span className="bg-muted text-muted-foreground rounded px-2 py-0.5">
							tz: {cls.detectedTimezone}
						</span>
					) : null}
					{cls.mentionsPricing ? (
						<span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
							mentions_pricing = true (deferred to call)
						</span>
					) : null}
					{cls.asksIfBot ? (
						<span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-300">
							asks_if_bot = true (honest disclosure verified)
						</span>
					) : null}
					<span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
						<ShieldCheck className="h-3.5 w-3.5" />
						<span>Guards checked</span>
					</span>
				</div>
			) : null}
		</div>
	);
}

function ThreadListPane({
	activeThreadId,
	entries,
	isLoading,
	onSelect,
}: {
	activeThreadId: string | null;
	entries: ThreadListEntry[];
	isLoading: boolean;
	onSelect: (id: string) => void;
}) {
	if (isLoading) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				Loading threads…
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
		<>
			{entries.map((entry) => {
				const isSelected = entry.thread.id === activeThreadId;
				return (
					<button
						className={cn(
							"w-full rounded-xl border p-3.5 text-left transition-all",
							isSelected
								? "border-primary bg-card ring-primary/25 shadow-xs ring-1"
								: "border-border/70 bg-card/70 hover:bg-card"
						)}
						key={entry.thread.id}
						onClick={() => onSelect(entry.thread.id)}
						type="button"
					>
						<div className="flex items-start justify-between gap-2">
							<div className="text-foreground text-sm font-semibold">
								{entry.company?.name ?? "Prospect"}
							</div>
							{entry.thread.pendingJobId ? (
								<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
									<Loader2 className="h-3 w-3 animate-spin" />
									<span>AI working</span>
								</span>
							) : null}
						</div>
						<div className="text-muted-foreground mt-0.5 text-xs">
							{entry.contact?.fullName} · {entry.contact?.title}
						</div>
						<div className="text-foreground/80 mt-2 truncate font-mono text-xs">
							{entry.latestMessage?.subject ?? "Ledgerwise Intro"}
						</div>
						<div className="mt-2.5 flex items-center justify-between">
							<ThreadStateBadge status={entry.thread.status} />
							<span className="text-muted-foreground font-mono text-[10px]">
								{entry.thread.prospectTimezone}
							</span>
						</div>
					</button>
				);
			})}
		</>
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

function InboxThreadInspector({
	company,
	contact,
	meetings,
	messages,
	showSimulator,
	thread,
}: {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	meetings: SdrMeetingItem[];
	messages: SdrMessageItem[];
	showSimulator: boolean;
	thread: SdrThreadItem;
}) {
	const {
		takeoverThread,
		releaseThread,
		sendHumanReply,
		simulateInboundReply,
		isTakingOver,
		isReleasing,
		isSendingHumanReply,
		isSimulatingInbound,
	} = useSdrThreadMutations();

	const [humanReplyText, setHumanReplyText] = useState("");
	const [simulatorText, setSimulatorText] = useState<string>(
		SIMULATOR_PRESETS[0].bodyText
	);

	const isOptedOut = thread.status === "opted_out";
	const isPollingJob = Boolean(thread.pendingJobId);

	const handleSendHumanReply = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!humanReplyText.trim()) {
			return;
		}
		await sendHumanReply({
			bodyText: humanReplyText.trim(),
			threadId: thread.id,
		});
		setHumanReplyText("");
	};

	const handleSimulateReply = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!simulatorText.trim()) {
			return;
		}
		await simulateInboundReply({
			bodyText: simulatorText.trim(),
			preset: "custom",
			threadId: thread.id,
		});
	};

	return (
		<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5">
			{/* Thread Top Bar */}
			<div className="border-border/70 flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-start">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-foreground text-lg font-bold">
							{company?.name ?? "Prospect"}
						</h2>
						<ThreadStateBadge status={thread.status} />
						{company ? (
							<TierBadge score={company.score} tier={company.tier} />
						) : null}
					</div>
					<div className="text-muted-foreground text-xs">
						Contact:{" "}
						<span className="text-foreground font-medium">
							{contact?.fullName} ({contact?.title})
						</span>{" "}
						·{" "}
						<span className="font-mono">
							{contact?.email} · TZ: {thread.prospectTimezone}
						</span>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<TakeoverControlButton
						aiMode={thread.aiMode}
						isOptedOut={isOptedOut}
						isReleasing={isReleasing}
						isTakingOver={isTakingOver}
						onRelease={() => void releaseThread(thread.id)}
						onTakeover={() => void takeoverThread(thread.id)}
					/>

					{company ? (
						<Button asChild size="sm" variant="ghost">
							<Link href={`/dashboard/companies?companyId=${company.id}`}>
								Brief →
							</Link>
						</Button>
					) : null}
				</div>
			</div>

			{/* Live BullMQ Polling Status Banner */}
			{isPollingJob ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
					<div className="flex items-center gap-2.5">
						<Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-300" />
						<div>
							<span className="font-semibold">
								AI SDR is evaluating inbound reply in BullMQ (
								<code className="font-mono">{thread.pendingJobId}</code>)…
							</span>
							<p className="text-[11px] opacity-90">
								Polling live every 1.5s — running opt-out check,
								intent/confidence classifier, playbook RAG, and zero pricing
								guard.
							</p>
						</div>
					</div>
				</div>
			) : null}

			{/* Escalation Banner when Needs Human */}
			{thread.status === "needs_human" ? (
				<div className="flex flex-col justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-900 sm:flex-row sm:items-center dark:text-rose-200">
					<div className="space-y-0.5">
						<div className="flex items-center gap-1.5 font-semibold">
							<AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
							<span>AI Paused & Escalated to Human Representative</span>
						</div>
						<p>
							{thread.handoffReason ??
								"Prospect asked a question outside the approved playbook or below the 0.75 confidence threshold."}
						</p>
					</div>
					<span className="shrink-0 rounded bg-rose-500/20 px-2 py-1 font-mono text-[11px] font-semibold">
						ai_mode = paused
					</span>
				</div>
			) : null}

			{/* Hard Opt-Out Suppression Lock Banner */}
			{isOptedOut ? (
				<div className="border-border bg-muted/70 text-muted-foreground flex items-center gap-2.5 rounded-lg border p-3.5 text-xs">
					<Lock className="text-foreground h-4 w-4 shrink-0" />
					<div>
						<strong className="text-foreground">
							Hard Opt-Out & Suppression Gate Active:
						</strong>{" "}
						{contact?.email} is recorded in{" "}
						<code className="font-mono">suppressions</code>. All AI and human
						outbound emails to this address are permanently blocked.
					</div>
				</div>
			) : null}

			{/* Booked Meeting Callout */}
			{meetings.length > 0 ? (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-900 dark:text-emerald-200">
					<div className="flex items-center gap-2">
						<CalendarCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
						<div>
							<span className="font-semibold">Discovery Call Booked: </span>
							<span>
								{new Date(meetings[0]?.startAt ?? "").toLocaleString([], {
									dateStyle: "medium",
									timeStyle: "short",
								})}{" "}
								({meetings[0]?.timezone})
							</span>
						</div>
					</div>
					<Link className="font-semibold underline" href="/dashboard/meetings">
						View in Meetings →
					</Link>
				</div>
			) : null}

			{/* Prospect Reply Simulator Panel */}
			{showSimulator ? (
				<form
					className="border-primary/35 bg-primary/5 space-y-3 rounded-xl border p-4"
					onSubmit={handleSimulateReply}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
							<FlaskConical className="text-primary h-4 w-4" />
							<span>
								Sandbox Prospect Reply Simulator (Injects Inbound Reply as{" "}
								{contact?.fullName ?? "Prospect"})
							</span>
						</div>
						<span className="text-muted-foreground font-mono text-[11px]">
							POST /api/sdr/threads/:id/simulate-inbound
						</span>
					</div>

					<div className="flex flex-wrap gap-1.5">
						{SIMULATOR_PRESETS.map((preset) => (
							<button
								className={cn(
									"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
									simulatorText === preset.bodyText
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-card text-foreground hover:bg-muted"
								)}
								key={preset.label}
								onClick={() => setSimulatorText(preset.bodyText)}
								title={preset.description}
								type="button"
							>
								{preset.label}
							</button>
						))}
					</div>

					<textarea
						className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border p-2.5 text-xs focus:outline-none"
						onChange={(e) => setSimulatorText(e.target.value)}
						placeholder="Type a simulated reply from the prospect…"
						rows={3}
						value={simulatorText}
					/>

					<div className="flex items-center justify-between gap-2">
						<span className="text-muted-foreground text-[11px]">
							Triggers inbound classifier, guard checks, and live 1.5s UI
							polling.
						</span>
						<Button
							disabled={isSimulatingInbound || !simulatorText.trim()}
							size="sm"
							type="submit"
							variant="primary"
						>
							<Sparkles className="h-3.5 w-3.5" />
							<span>
								{isSimulatingInbound
									? "Injecting Reply…"
									: "Simulate Prospect Reply"}
							</span>
						</Button>
					</div>
				</form>
			) : null}

			{/* Conversation Message Timeline */}
			<div className="space-y-3 pt-1">
				<div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
					Conversation Timeline ({messages.length} messages)
				</div>

				<div className="space-y-3">
					{messages.map((msg) => (
						<MessageCard key={msg.id} msg={msg} />
					))}
				</div>
			</div>

			{/* Human Reply Composer */}
			{isOptedOut ? null : (
				<form
					className="border-border/70 space-y-2.5 border-t pt-4"
					onSubmit={handleSendHumanReply}
				>
					<div className="flex items-center justify-between">
						<label
							className="text-foreground text-xs font-semibold"
							htmlFor="human-reply-textarea"
						>
							Send Reply as Human Sales Representative (Zero-Pricing Guard
							Enforced)
						</label>
						<span className="text-muted-foreground text-[11px]">
							Sending switches thread to{" "}
							<code className="font-mono">You&apos;re handling</code>
						</span>
					</div>
					<textarea
						className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border p-3 text-sm focus:outline-none"
						id="human-reply-textarea"
						onChange={(e) => setHumanReplyText(e.target.value)}
						placeholder={`Write a direct reply to ${contact?.fullName ?? "the prospect"} (remember: never quote pricing in email, book a discovery call)…`}
						rows={3}
						value={humanReplyText}
					/>
					<div className="flex items-center justify-between gap-2">
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
							variant="outline"
						>
							<Sparkles className="h-3.5 w-3.5" />
							<span>Suggest Safe Draft</span>
						</Button>
						<Button
							disabled={isSendingHumanReply || !humanReplyText.trim()}
							size="sm"
							type="submit"
							variant="primary"
						>
							<Send className="h-3.5 w-3.5" />
							<span>
								{isSendingHumanReply ? "Sending Reply…" : "Send Human Reply"}
							</span>
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
	const [showSimulator, setShowSimulator] = useState(true);

	const { data: rawThreads = [], isLoading } = useSdrThreads(
		statusFilter === "all" ? undefined : statusFilter
	);
	const entries = rawThreads as unknown as ThreadListEntry[];

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
		<div className="mx-auto max-w-6xl space-y-5 p-6 sm:p-8">
			{/* Page Header */}
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-foreground text-2xl font-bold tracking-tight">
						Prospect Conversation Inbox & Reply Simulator
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						Monitor autonomous AI SDR replies, step into escalated threads, or
						simulate inbound prospect replies with live 1.5s queue polling.
					</p>
				</div>

				<Button
					onClick={() => setShowSimulator((prev) => !prev)}
					size="sm"
					variant={showSimulator ? "primary" : "outline"}
				>
					<FlaskConical className="h-3.5 w-3.5" />
					<span>
						{showSimulator
							? "Hide Prospect Simulator"
							: "Open Prospect Reply Simulator"}
					</span>
				</Button>
			</div>

			{/* State Filter Pills */}
			<div className="flex flex-wrap items-center gap-1.5">
				{(
					[
						{ key: "all", label: "All Conversations" },
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

			{/* Main Split View */}
			<div className="grid gap-6 lg:grid-cols-12">
				<div className="space-y-2.5 lg:col-span-4">
					<ThreadListPane
						activeThreadId={activeThreadId}
						entries={entries}
						isLoading={isLoading}
						onSelect={setSelectedThreadId}
					/>
				</div>

				<div className="space-y-4 lg:col-span-8">
					{detail ? (
						<InboxThreadInspector
							company={detail.company as SdrCompanySummary | null}
							contact={detail.contact as SdrCompanySummary["primaryContact"]}
							meetings={detail.meetings as SdrMeetingItem[]}
							messages={detail.messages as SdrMessageItem[]}
							showSimulator={showSimulator}
							thread={detail.thread as SdrThreadItem}
						/>
					) : (
						<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
							Select a thread on the left to inspect the conversation.
						</div>
					)}
				</div>
			</div>
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

"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	AlertCircle,
	ArrowRight,
	CalendarCheck,
	CheckCircle2,
	Inbox,
	RotateCcw,
} from "lucide-react";
import Link from "next/link";
import {
	useSdrCompanies,
	useSdrDashboard,
	useSdrSettings,
} from "@/lib/sdr-hooks";
import { SignalChip, ThreadStateBadge, TierBadge } from "./sdr-badges";

const ACTION_CARD_TONES = {
	amber: {
		text: "text-amber-600 dark:text-amber-400",
	},
	emerald: {
		text: "text-emerald-600 dark:text-emerald-400",
	},
	rose: {
		text: "text-rose-600 dark:text-rose-400",
	},
} as const;

export function SdrTodayClient({ userName }: { userName: string }) {
	const {
		data: dashboardData,
		error: dashboardError,
		isError: isDashboardError,
		isLoading,
		refetch: refetchDashboard,
	} = useSdrDashboard();
	const { data: companies = [] } = useSdrCompanies();
	const { resetDemoData, isResettingDemo } = useSdrSettings();

	const kpis = dashboardData?.kpis;
	const needsHumanThreads = dashboardData?.needsHumanThreads ?? [];
	const pendingReviews = dashboardData?.pendingReviews ?? [];
	const recentActivity = dashboardData?.recentActivity ?? [];
	const visiblePendingReviews = pendingReviews.slice(0, 5);
	const visibleNeedsHumanThreads = needsHumanThreads.slice(
		0,
		Math.max(0, 5 - visiblePendingReviews.length)
	);
	const visibleRecentActivity = recentActivity.slice(0, 20);
	const visibleCompanies = companies.slice(0, 5);

	const actionCards = [
		{
			count: kpis?.pendingReviewCount ?? 0,
			href: "/dashboard/review",
			icon: CheckCircle2,
			subtitle: "First-touch drafts awaiting sign-off",
			title: "Emails to Approve",
			tone: "amber" as const,
		},
		{
			count: kpis?.needsHumanCount ?? 0,
			href: "/dashboard/inbox?status=needs_human",
			icon: AlertCircle,
			subtitle: "Threads paused for human reply",
			title: "Replies Needing You",
			tone: "rose" as const,
		},
		{
			count: kpis?.bookedCount ?? 0,
			href: "/dashboard/meetings",
			icon: CalendarCheck,
			subtitle: "Founders scheduled for discovery",
			title: "Booked Calls",
			tone: "emerald" as const,
		},
	];

	const pipelineStats = [
		{
			label: "Exa Suggested",
			title: "Total Exa discovery results evaluated across batches",
			value: kpis?.exaSuggestedCount ?? 0,
		},
		{
			label: "Pre-filtered",
			title:
				"Exa results disqualified or skipped before detailed company research (ICP pre-screen, unresolved domain, or duplicate)",
			value: kpis?.preFilteredCount ?? 0,
		},
		{ label: "Researched", value: kpis?.researchedCount ?? 0 },
		{ label: "Qualified", value: kpis?.qualifiedCount ?? 0 },
		{ label: "Contacted", value: kpis?.contactedCount ?? 0 },
		{ label: "Replied", value: kpis?.repliedCount ?? 0 },
	];

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			{/* Header */}
			<div className="border-border/70 flex flex-col justify-between gap-3 border-b pb-5 md:flex-row md:items-center">
				<div className="min-w-0 flex-1 space-y-1">
					<h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
						Today at Ledgerwise, {userName.split(" ")[0]}
					</h1>
					<p className="text-muted-foreground max-w-2xl text-sm">
						Review verified first-touch drafts, step into escalated threads, and
						track booked discovery calls.
					</p>
				</div>

				<div className="flex min-w-0 flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap md:justify-end">
					<Button
						disabled={isResettingDemo}
						onClick={() => void resetDemoData()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						<span>{isResettingDemo ? "Restoring…" : "Reset Demo Dataset"}</span>
					</Button>
					<Button asChild size="sm" variant="primary">
						<Link href="/dashboard/settings/playbook">
							<span>Edit Playbook</span>
						</Link>
					</Button>
				</div>
			</div>

			{/* Unified Action Queue & Pipeline Overview */}
			{isDashboardError ? (
				<div
					className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"
					role="alert"
				>
					<span>
						{dashboardError instanceof Error
							? dashboardError.message
							: "Failed to load SDR dashboard summary."}
					</span>
					<Button
						onClick={() => void refetchDashboard()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}

			<section
				aria-label="Action items and pipeline summary"
				className="border-border/70 bg-card overflow-hidden rounded-xl border"
			>
				<div className="divide-border/60 grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
					{actionCards.map((card) => {
						const Icon = card.icon;
						const tone = ACTION_CARD_TONES[card.tone];
						return (
							<Link
								className="group hover:bg-muted/30 flex items-center justify-between gap-3 px-5 py-4 transition-colors"
								href={card.href}
								key={card.href}
							>
								<div className="min-w-0 space-y-1">
									<div className="flex items-center gap-1.5 text-xs font-medium">
										<Icon className={cn("h-3.5 w-3.5 shrink-0", tone.text)} />
										<span className="text-foreground truncate">
											{card.title}
										</span>
									</div>
									<p className="text-muted-foreground truncate text-xs">
										{card.subtitle}
									</p>
								</div>

								<div className="flex shrink-0 items-center gap-2">
									<span className="text-foreground font-mono text-2xl font-bold tabular-nums">
										{isLoading ? "…" : card.count}
									</span>
									<ArrowRight className="text-muted-foreground/70 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</div>
							</Link>
						);
					})}
				</div>

				<div className="border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-5 py-2.5">
					<div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
						<span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
							Pipeline
						</span>
						{pipelineStats.map((metric) => (
							<div
								className="flex items-baseline gap-1.5"
								key={metric.label}
								title={metric.title}
							>
								<span className="text-muted-foreground text-xs">
									{metric.label}
								</span>
								<span className="text-foreground font-mono text-xs font-semibold tabular-nums">
									{isLoading ? "–" : metric.value}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Two-Column Split: Escalated / Pending Threads + Recent Qualified Prospects */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
				<section className="min-w-0 space-y-6 lg:col-span-7">
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-foreground min-w-0 truncate text-sm font-semibold tracking-tight">
								Needs Your Attention
							</h2>
							<Link
								className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline"
								href="/dashboard/inbox"
							>
								<span>All conversations</span>
								<ArrowRight className="h-3 w-3" />
							</Link>
						</div>

						<div className="divide-border/70 border-border/70 bg-card divide-y overflow-hidden rounded-xl border">
							{visiblePendingReviews.map((review) => (
								<div
									className="flex flex-col justify-between gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
									key={review.id}
								>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-foreground text-sm font-semibold">
												{review.companyName}
											</span>
											<ThreadStateBadge
												isCompact={true}
												status="awaiting_review"
											/>
										</div>
										<p className="text-muted-foreground truncate text-xs">
											{review.contactName ?? "Founder"} · {review.subject}
										</p>
									</div>
									<Button
										asChild
										className="shrink-0"
										size="sm"
										variant="outline"
									>
										<Link href="/dashboard/review">
											<span>Review Draft</span>
										</Link>
									</Button>
								</div>
							))}

							{visibleNeedsHumanThreads.map((thread) => (
								<div
									className="flex flex-col justify-between gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
									key={thread.id}
								>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-foreground text-sm font-semibold">
												{thread.companyName}
											</span>
											<ThreadStateBadge
												isCompact={true}
												status={thread.status}
											/>
										</div>
										{thread.handoffReason ? (
											<p className="text-xs text-rose-600 dark:text-rose-400">
												{thread.handoffReason}
											</p>
										) : null}
									</div>
									<Button
										asChild
										className="shrink-0"
										size="sm"
										variant="outline"
									>
										<Link href={`/dashboard/inbox?threadId=${thread.id}`}>
											<Inbox className="h-3.5 w-3.5" />
											<span>Reply in Inbox</span>
										</Link>
									</Button>
								</div>
							))}

							{pendingReviews.length === 0 && needsHumanThreads.length === 0 ? (
								<div className="text-muted-foreground p-6 text-center text-sm">
									All inbox threads are either handled by AI or booked.
								</div>
							) : null}
						</div>
					</div>

					{/* Recent AI Decision & Guard Trace */}
					<div className="space-y-3">
						<h3 className="text-foreground text-sm font-semibold tracking-tight">
							Recent AI Activity
						</h3>
						<div className="custom-scrollbar divide-border/70 border-border/70 bg-card max-h-80 divide-y overflow-y-auto rounded-xl border">
							{visibleRecentActivity.map((run) => (
								<div
									className="flex items-start justify-between gap-3 px-4 py-3 text-xs"
									key={run.id}
								>
									<div className="min-w-0 flex-1 space-y-0.5">
										<div className="flex flex-wrap items-center gap-2">
											<span className="border-border/70 bg-muted/50 text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase">
												{run.step}
											</span>
											<span className="text-foreground font-medium">
												{run.companyName ?? "Prospect"} — {run.decision}
											</span>
										</div>
										<div className="text-muted-foreground/80 truncate font-mono text-[11px]">
											{run.model} · {run.latencyMs}ms
										</div>
									</div>
									<span className="text-muted-foreground shrink-0 font-mono text-[11px]">
										{new Date(run.createdAt).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Right Column: Top Researched Prospects */}
				<section className="min-w-0 space-y-3 lg:col-span-5">
					<div className="flex items-center justify-between gap-2">
						<h2 className="text-foreground min-w-0 truncate text-sm font-semibold tracking-tight">
							Researched Prospects
						</h2>
						<Link
							className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline"
							href="/dashboard/companies"
						>
							<span>All companies</span>
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>

					<div className="divide-border/70 border-border/70 bg-card divide-y overflow-hidden rounded-xl border">
						{visibleCompanies.map((company) => {
							const visibleSignals = company.signals.slice(0, 2);
							const extraSignalsCount =
								company.signals.length - visibleSignals.length;
							return (
								<Link
									className="hover:bg-muted/30 block min-w-0 space-y-2 p-4 transition-colors"
									href={`/dashboard/companies?companyId=${company.id}`}
									key={company.id}
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<div className="text-foreground truncate text-sm font-semibold">
												{company.name}
											</div>
											<div className="text-muted-foreground truncate font-mono text-xs">
												{company.domain} ·{" "}
												{company.hqLocation ?? "United States"}
											</div>
										</div>
										<div className="shrink-0">
											<TierBadge score={company.score} tier={company.tier} />
										</div>
									</div>
									<p className="text-muted-foreground line-clamp-2 text-xs">
										{company.summary}
									</p>
									{visibleSignals.length > 0 ? (
										<div className="flex flex-wrap items-center gap-1">
											{visibleSignals.map((sig) => (
												<SignalChip key={sig} signal={sig} />
											))}
											{extraSignalsCount > 0 ? (
												<span className="text-muted-foreground px-1 text-[11px]">
													+{extraSignalsCount}
												</span>
											) : null}
										</div>
									) : null}
								</Link>
							);
						})}
					</div>
				</section>
			</div>
		</div>
	);
}

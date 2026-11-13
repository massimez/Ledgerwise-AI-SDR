"use client";

import { Button } from "@workspace/ui/components/button";
import {
	AlertCircle,
	ArrowRight,
	Bot,
	Building2,
	CalendarCheck,
	CheckCircle2,
	Inbox,
	RotateCcw,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { SdrAutopilotMode } from "@/lib/sdr-fallback-data";
import {
	useSdrCompanies,
	useSdrDashboard,
	useSdrSettings,
} from "@/lib/sdr-hooks";
import { SignalChip, ThreadStateBadge, TierBadge } from "./sdr-badges";

function formatAutopilotLabel(mode: SdrAutopilotMode | undefined): string {
	if (mode === "full") {
		return "Full Autopilot";
	}
	if (mode === "off") {
		return "Manual Approval Only";
	}
	return "Auto-Reply (First Email Reviewed)";
}

export function SdrTodayClient({ userName }: { userName: string }) {
	const { data: dashboardData, isLoading } = useSdrDashboard();
	const { data: companies = [] } = useSdrCompanies();
	const {
		data: settingsData,
		resetDemoData,
		isResettingDemo,
	} = useSdrSettings();

	const kpis = dashboardData?.kpis;
	const needsHumanThreads = dashboardData?.needsHumanThreads ?? [];
	const pendingReviews = dashboardData?.pendingReviews ?? [];
	const recentActivity = dashboardData?.recentActivity ?? [];
	const autopilotMode = settingsData?.settings.autopilot;

	const funnelItems = [
		{ label: "Researched", value: kpis?.researchedCount ?? 0 },
		{ label: "Qualified (Tier A/B)", value: kpis?.qualifiedCount ?? 0 },
		{ label: "Pending Review", value: kpis?.pendingReviewCount ?? 0 },
		{ label: "Contacted", value: kpis?.contactedCount ?? 0 },
		{ label: "Replied", value: kpis?.repliedCount ?? 0 },
		{ label: "Needs You", value: kpis?.needsHumanCount ?? 0 },
		{ label: "Calls Booked", value: kpis?.bookedCount ?? 0 },
	];

	return (
		<div className="mx-auto max-w-6xl space-y-8 p-6 sm:p-8">
			{/* Header & Autopilot bar */}
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
							<Bot className="h-3.5 w-3.5" />
							<span>Autopilot: {formatAutopilotLabel(autopilotMode)}</span>
						</span>
						<span className="border-border/70 bg-card text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
							<ShieldCheck className="text-primary h-3.5 w-3.5" />
							<span>Zero-Price & Evidence Guards Active</span>
						</span>
					</div>
					<h1 className="text-foreground pt-1 text-2xl font-bold tracking-tight sm:text-3xl">
						Today at Ledgerwise, {userName.split(" ")[0]}
					</h1>
					<p className="text-muted-foreground text-sm">
						E-commerce bookkeeping SDR desk — review verified first-touch
						drafts, step into escalated threads, and inspect upcoming discovery
						calls.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2.5">
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

			{/* Primary "Needs You" Action Cards */}
			<section aria-label="Action items needing your attention">
				<div className="grid gap-4 md:grid-cols-3">
					<div className="bg-card flex flex-col justify-between rounded-xl border border-amber-500/30 p-5 shadow-2xs">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">
									<CheckCircle2 className="h-4 w-4" />
									<span>First Emails to Approve</span>
								</span>
								<span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-amber-700 tabular-nums dark:text-amber-300">
									{isLoading ? "…" : (kpis?.pendingReviewCount ?? 0)}
								</span>
							</div>
							<p className="text-foreground text-sm font-medium">
								Verified <span className="font-mono">&lt;100w</span> plain-text
								first emails waiting for human sign-off.
							</p>
							<p className="text-muted-foreground text-xs">
								Every claim is linked to a verbatim source quote. Zero links,
								zero pricing.
							</p>
						</div>
						<div className="pt-4">
							<Button
								asChild
								className="w-full justify-between"
								size="sm"
								variant="outline"
							>
								<Link href="/dashboard/review">
									<span>Open Review Queue</span>
									<ArrowRight className="h-3.5 w-3.5" />
								</Link>
							</Button>
						</div>
					</div>

					<div className="bg-card flex flex-col justify-between rounded-xl border border-rose-500/30 p-5 shadow-2xs">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-rose-700 uppercase dark:text-rose-300">
									<AlertCircle className="h-4 w-4" />
									<span>Replies Needing You</span>
								</span>
								<span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-rose-700 tabular-nums dark:text-rose-300">
									{isLoading ? "…" : (kpis?.needsHumanCount ?? 0)}
								</span>
							</div>
							<p className="text-foreground text-sm font-medium">
								Prospect threads paused by the AI escalation guard.
							</p>
							<p className="text-muted-foreground text-xs">
								Triggered when a prospect asks an out-of-playbook technical
								question, requests a human, or confidence is &lt; 0.75.
							</p>
						</div>
						<div className="pt-4">
							<Button
								asChild
								className="w-full justify-between"
								size="sm"
								variant="outline"
							>
								<Link href="/dashboard/inbox?status=needs_human">
									<span>Step into Inbox</span>
									<ArrowRight className="h-3.5 w-3.5" />
								</Link>
							</Button>
						</div>
					</div>

					<div className="bg-card flex flex-col justify-between rounded-xl border border-emerald-500/30 p-5 shadow-2xs">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-300">
									<CalendarCheck className="h-4 w-4" />
									<span>Booked Discovery Calls</span>
								</span>
								<span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
									{isLoading ? "…" : (kpis?.bookedCount ?? 0)}
								</span>
							</div>
							<p className="text-foreground text-sm font-medium">
								Qualified e-commerce founders booked onto the sales calendar.
							</p>
							<p className="text-muted-foreground text-xs">
								Includes full research brief, pain points, and conversation
								history for the AE call.
							</p>
						</div>
						<div className="pt-4">
							<Button
								asChild
								className="w-full justify-between"
								size="sm"
								variant="outline"
							>
								<Link href="/dashboard/meetings">
									<span>View Booked Calls</span>
									<ArrowRight className="h-3.5 w-3.5" />
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			{/* Pipeline Funnel Strip */}
			<section className="border-border/70 bg-card rounded-xl border p-5">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
						Pipeline Conversion Funnel
					</h2>
					<Link
						className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
						href="/dashboard/companies"
					>
						<span>Inspect all companies</span>
						<ArrowRight className="h-3 w-3" />
					</Link>
				</div>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
					{funnelItems.map((metric) => (
						<div
							className="border-border/60 bg-background/60 rounded-lg border p-3"
							key={metric.label}
						>
							<div className="text-muted-foreground text-[11px] font-medium">
								{metric.label}
							</div>
							<div className="text-foreground mt-1 font-mono text-xl font-bold tabular-nums">
								{isLoading ? "–" : metric.value}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Two-Column Split: Escalated / Pending Threads + Recent Qualified Prospects */}
			<div className="grid gap-6 lg:grid-cols-12">
				<section className="space-y-3 lg:col-span-7">
					<div className="flex items-center justify-between">
						<h2 className="text-foreground text-base font-semibold tracking-tight">
							Items Requiring Review or Human Takeover
						</h2>
						<Link
							className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
							href="/dashboard/inbox"
						>
							<span>All conversations</span>
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>

					<div className="divide-border/70 border-border/70 bg-card divide-y rounded-xl border">
						{pendingReviews.map((review) => (
							<div
								className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
								key={review.id}
							>
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-foreground text-sm font-semibold">
											{review.companyName}
										</span>
										<ThreadStateBadge status="awaiting_review" />
									</div>
									<p className="text-muted-foreground text-xs">
										{review.contactName ?? "Founder"} ·{" "}
										<span className="font-medium">{review.subject}</span>
									</p>
								</div>
								<Button asChild size="sm" variant="primary">
									<Link href="/dashboard/review">
										<span>Review Draft</span>
									</Link>
								</Button>
							</div>
						))}

						{needsHumanThreads.map((thread) => (
							<div
								className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
								key={thread.id}
							>
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-foreground text-sm font-semibold">
											{thread.companyName}
										</span>
										<ThreadStateBadge status={thread.status} />
									</div>
									{thread.handoffReason ? (
										<p className="text-xs text-rose-600 dark:text-rose-400">
											{thread.handoffReason}
										</p>
									) : null}
								</div>
								<Button asChild size="sm" variant="outline">
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

					{/* Recent AI Decision & Guard Trace */}
					<div className="pt-3">
						<h3 className="text-foreground mb-2.5 text-sm font-semibold">
							Recent AI SDR Guard & Decision Audit Log
						</h3>
						<div className="divide-border/70 border-border/70 bg-card divide-y rounded-xl border">
							{recentActivity.map((run) => (
								<div
									className="flex items-start justify-between gap-3 px-4 py-3 text-xs"
									key={run.id}
								>
									<div className="space-y-0.5">
										<div className="flex items-center gap-2">
											<span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase">
												{run.step}
											</span>
											<span className="text-foreground font-medium">
												{run.companyName ?? "Prospect"} — {run.decision}
											</span>
										</div>
										<div className="text-muted-foreground font-mono text-[11px]">
											Model: {run.model} · Latency: {run.latencyMs}ms
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
				<section className="space-y-3 lg:col-span-5">
					<div className="flex items-center justify-between">
						<h2 className="text-foreground text-base font-semibold tracking-tight">
							Researched E-Commerce Prospects
						</h2>
						<Link
							className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
							href="/dashboard/companies"
						>
							<span>All companies</span>
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>

					<div className="divide-border/70 border-border/70 bg-card divide-y rounded-xl border">
						{companies.map((company) => (
							<Link
								className="hover:bg-muted/40 block space-y-2 p-4 transition-colors"
								href={`/dashboard/companies?companyId=${company.id}`}
								key={company.id}
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<div className="flex items-center gap-1.5">
											<Building2 className="text-muted-foreground h-3.5 w-3.5" />
											<span className="text-foreground text-sm font-semibold">
												{company.name}
											</span>
										</div>
										<div className="text-muted-foreground font-mono text-xs">
											{company.domain} · {company.hqLocation ?? "United States"}
										</div>
									</div>
									<TierBadge score={company.score} tier={company.tier} />
								</div>
								<p className="text-muted-foreground line-clamp-2 text-xs">
									{company.summary}
								</p>
								<div className="flex flex-wrap gap-1">
									{company.signals.map((sig) => (
										<SignalChip key={sig} signal={sig} />
									))}
								</div>
							</Link>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}

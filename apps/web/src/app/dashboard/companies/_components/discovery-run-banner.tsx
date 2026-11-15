"use client";

import { Button } from "@workspace/ui/components/button";
import { AlertCircle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { SdrResearchRunItem } from "@/lib/sdr-types";

function formatPreFilteredBreakdown(run: SdrResearchRunItem): string | null {
	if (run.preFilteredCount <= 0) {
		return null;
	}
	const breakdown = run.preFilteredBreakdown;
	if (!breakdown) {
		return `${run.preFilteredCount} skipped before full research`;
	}
	const parts: string[] = [];
	if (breakdown.icpPreScreen > 0) {
		parts.push(`${breakdown.icpPreScreen} ICP pre-screen`);
	}
	const duplicates = breakdown.duplicateDomain + breakdown.duplicateUrl;
	if (duplicates > 0) {
		parts.push(`${duplicates} duplicate`);
	}
	if (breakdown.unresolvedDomain > 0) {
		parts.push(`${breakdown.unresolvedDomain} unresolved domain`);
	}
	return parts.length > 0
		? `Pre-filtered before research: ${parts.join(", ")}.`
		: `${run.preFilteredCount} skipped before full research.`;
}

function getCompletionSubtitle(run: SdrResearchRunItem): string {
	const breakdownText = formatPreFilteredBreakdown(run);
	let baseText: string;
	if (run.qualifiedCount > 0) {
		baseText =
			"Qualified Tier A/B brands have verified first-touch email drafts ready in the Review Queue.";
	} else if (run.foundCount === 0) {
		baseText = "No net-new brands passed pre-research checks for this query.";
	} else {
		baseText =
			"All discovered companies were evaluated against the Ledgerwise ICP rubric.";
	}
	return breakdownText ? `${breakdownText} ${baseText}` : baseText;
}

export function DiscoveryRunBanner({
	onDismiss,
	run,
}: {
	onDismiss: () => void;
	run: SdrResearchRunItem;
}) {
	const isActive = run.status === "queued" || run.status === "running";
	const isFailed = run.status === "failed";
	const isCompleted = run.status === "completed";

	const progressPercent =
		run.foundCount > 0
			? Math.min(100, Math.round((run.researchedCount / run.foundCount) * 100))
			: 0;

	if (isFailed) {
		return (
			<div
				className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
				role="alert"
			>
				<div className="flex min-w-0 items-center gap-2.5">
					<AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
					<div className="min-w-0">
						<span className="font-semibold">Lead discovery failed: </span>
						<span>{run.error ?? "Unable to complete research batch."}</span>
					</div>
				</div>
				<Button
					aria-label="Dismiss discovery error"
					onClick={onDismiss}
					size="sm"
					type="button"
					variant="ghost"
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>
		);
	}

	const exaSuggested = Math.max(
		run.exaSuggestedCount,
		run.foundCount + run.preFilteredCount
	);

	if (isCompleted) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
				<div className="flex min-w-0 items-center gap-2.5">
					<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
					<div className="min-w-0 space-y-0.5">
						<div className="font-semibold">
							Discovery batch complete — {exaSuggested} Exa suggested,{" "}
							{run.preFilteredCount} pre-filtered, {run.foundCount} queued,{" "}
							{run.researchedCount} researched, {run.qualifiedCount} qualified
						</div>
						<p className="text-[11px] opacity-85">
							{getCompletionSubtitle(run)}
						</p>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{run.qualifiedCount > 0 ? (
						<Button asChild size="sm" variant="primary">
							<Link href="/dashboard/review">Review Drafts →</Link>
						</Button>
					) : null}
					<Button
						aria-label="Dismiss discovery summary"
						onClick={onDismiss}
						size="sm"
						type="button"
						variant="ghost"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="border-primary/30 bg-primary/5 space-y-2.5 rounded-xl border px-4 py-3.5 text-xs">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2.5">
					<Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />
					<div>
						<div className="text-foreground flex items-center gap-1.5 font-semibold">
							<span>
								{run.status === "queued"
									? "Queued lead discovery batch…"
									: "Discovering, verifying evidence & drafting first emails…"}
							</span>
						</div>
						<p className="text-muted-foreground mt-0.5 truncate text-[11px]">
							Query: {run.querySet[0] ?? "US e-commerce brands"}
						</p>
					</div>
				</div>

				<div className="text-foreground flex shrink-0 flex-wrap items-center gap-3 font-mono text-[11px]">
					{exaSuggested > 0 ? (
						<>
							<span>{exaSuggested} Exa suggested</span>
							<span>·</span>
						</>
					) : null}
					{run.preFilteredCount > 0 ? (
						<>
							<span>{run.preFilteredCount} pre-filtered</span>
							<span>·</span>
						</>
					) : null}
					<span>{run.foundCount} found</span>
					<span>·</span>
					<span>
						{run.researchedCount}/{run.foundCount || "…"} researched
					</span>
					<span>·</span>
					<span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
						<Sparkles className="h-3 w-3" />
						{run.qualifiedCount} qualified
					</span>
				</div>
			</div>

			{isActive ? (
				<div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
					<div
						className="bg-primary h-full transition-all duration-300"
						style={{
							width: `${run.foundCount > 0 ? Math.max(12, progressPercent) : 10}%`,
						}}
					/>
				</div>
			) : null}
		</div>
	);
}

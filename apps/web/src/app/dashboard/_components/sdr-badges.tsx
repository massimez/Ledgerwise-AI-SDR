"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { CompanyTier, ThreadStatus } from "@/lib/sdr-fallback-data";

export function TierBadge({
	score,
	tier,
}: {
	score: number;
	tier: CompanyTier;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums",
				tier === "A" &&
					"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
				tier === "B" &&
					"border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
				tier === "C" &&
					"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
				tier === "DQ" &&
					"border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
			)}
		>
			<span>{tier === "DQ" ? "Disqualified" : `Tier ${tier}`}</span>
			<span className="opacity-70">·</span>
			<span>{score}/100</span>
		</span>
	);
}

const THREAD_STATUS_LABELS: Record<
	ThreadStatus,
	{
		label: string;
		tone: "amber" | "emerald" | "indigo" | "neutral" | "rose" | "sky";
	}
> = {
	active: { label: "AI handling", tone: "sky" },
	awaiting_review: { label: "Needs review", tone: "amber" },
	booked: { label: "Call booked", tone: "emerald" },
	closed: { label: "Closed", tone: "neutral" },
	draft: { label: "Draft", tone: "neutral" },
	human: { label: "You're handling", tone: "indigo" },
	needs_human: { label: "Needs you", tone: "rose" },
	opted_out: { label: "Opted out (Suppressed)", tone: "neutral" },
};

export function ThreadStateBadge({ status }: { status: ThreadStatus }) {
	const meta = THREAD_STATUS_LABELS[status];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
				meta.tone === "amber" &&
					"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
				meta.tone === "emerald" &&
					"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
				meta.tone === "indigo" &&
					"border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
				meta.tone === "rose" &&
					"border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
				meta.tone === "sky" &&
					"border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
				meta.tone === "neutral" &&
					"border-border/70 bg-muted/60 text-muted-foreground"
			)}
		>
			<span
				className={cn(
					"h-1.5 w-1.5 rounded-full",
					meta.tone === "amber" && "bg-amber-500",
					meta.tone === "emerald" && "bg-emerald-500",
					meta.tone === "indigo" && "bg-indigo-500",
					meta.tone === "rose" && "bg-rose-500",
					meta.tone === "sky" && "bg-sky-500",
					meta.tone === "neutral" && "bg-muted-foreground"
				)}
			/>
			<span>{meta.label}</span>
		</span>
	);
}

export function SignalChip({ signal }: { signal: string }) {
	const lower = signal.toLowerCase();
	const isDisqualifier =
		lower.includes("disqualif") ||
		lower.includes("enterprise") ||
		lower.includes("public");
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
				isDisqualifier
					? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
					: "border-border/70 bg-muted/50 text-foreground/85"
			)}
		>
			{signal}
		</span>
	);
}

"use client";

import { sanitizeExternalHttpUrl } from "@workspace/ai-core/contracts";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarCheck, Clock, Inbox, User, Video } from "lucide-react";
import Link from "next/link";
import { type SdrMeetingListEntry, useSdrMeetings } from "@/lib/sdr-hooks";
import { SignalChip, TierBadge } from "../_components/sdr-badges";

interface DayGroup {
	dayKey: string;
	dayLabel: string;
	entries: SdrMeetingListEntry[];
}

function getMeetingDayInfo(
	startAt: string,
	timeZone: string
): { dayKey: string; dayLabel: string } {
	const date = new Date(startAt);
	if (Number.isNaN(date.getTime())) {
		return { dayKey: "unscheduled", dayLabel: "Unscheduled" };
	}
	try {
		const dayKey = new Intl.DateTimeFormat("en-CA", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			timeZone,
		}).format(date);
		const dayLabel = new Intl.DateTimeFormat("en-US", {
			weekday: "long",
			month: "long",
			day: "numeric",
			year: "numeric",
			timeZone,
		}).format(date);
		return { dayKey, dayLabel };
	} catch {
		const isoDay = date.toISOString().slice(0, 10);
		return { dayKey: isoDay, dayLabel: isoDay };
	}
}

function groupMeetingsByDay(entries: SdrMeetingListEntry[]): DayGroup[] {
	const groups = new Map<string, DayGroup>();
	for (const entry of entries) {
		const { dayKey, dayLabel } = getMeetingDayInfo(
			entry.meeting.startAt,
			entry.meeting.timezone
		);
		const existing = groups.get(dayKey);
		if (existing) {
			existing.entries.push(entry);
		} else {
			groups.set(dayKey, { dayKey, dayLabel, entries: [entry] });
		}
	}
	return [...groups.values()];
}

function getMeetingStatusMeta(status: string): {
	dotClass: string;
	label: string;
	textClass: string;
} {
	const label = status
		? status.charAt(0).toUpperCase() + status.slice(1)
		: "Scheduled";
	if (status === "cancelled") {
		return {
			dotClass: "bg-rose-500",
			label,
			textClass: "text-rose-700 dark:text-rose-300",
		};
	}
	if (status === "completed") {
		return {
			dotClass: "bg-muted-foreground",
			label,
			textClass: "text-muted-foreground",
		};
	}
	return {
		dotClass: "bg-emerald-500",
		label,
		textClass: "text-emerald-700 dark:text-emerald-300",
	};
}

function MeetingPrepBrief({
	company,
}: {
	company: NonNullable<SdrMeetingListEntry["company"]>;
}) {
	return (
		<div className="border-border/60 space-y-2 border-t pt-3 md:col-span-5 md:border-t-0 md:border-l md:pt-0 md:pl-5">
			<div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
				Call Prep Brief
			</div>
			<p className="text-muted-foreground text-xs leading-relaxed">
				{company.summary}
			</p>
			{company.signals.length > 0 ? (
				<div className="flex flex-wrap gap-1 pt-0.5">
					{company.signals.slice(0, 3).map((sig) => (
						<SignalChip key={sig} signal={sig} />
					))}
				</div>
			) : null}
		</div>
	);
}

function MeetingCard({ company, contact, meeting }: SdrMeetingListEntry) {
	const isCancelled = meeting.status === "cancelled";
	const statusMeta = getMeetingStatusMeta(meeting.status);
	const isSandbox =
		meeting.calBookingUid.startsWith("sim_cal_") ||
		meeting.meetingUrl?.includes("ledgerwise-sandbox");

	return (
		<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5 shadow-2xs">
			{/* Card Top Bar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-xs">
					<span
						className={cn(
							"inline-flex items-center gap-1.5 font-medium",
							statusMeta.textClass
						)}
					>
						<span
							className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dotClass)}
						/>
						<span>{statusMeta.label}</span>
					</span>
					<span className="text-muted-foreground">·</span>
					<span className="text-muted-foreground">
						{isSandbox ? "Sandbox Cal.com" : "Live Cal.com"}
					</span>
				</div>

				{company ? (
					<TierBadge score={company.score} tier={company.tier} />
				) : null}
			</div>

			{/* Main Content Split */}
			<div className="grid gap-5 md:grid-cols-12">
				<div
					className={cn(
						"min-w-0 space-y-3",
						company ? "md:col-span-7" : "md:col-span-12"
					)}
				>
					<div className="space-y-1">
						<h3 className="text-foreground text-base leading-snug font-semibold">
							{meeting.title}
						</h3>
						{company ? (
							<p className="text-muted-foreground font-mono text-xs">
								{company.domain} · {company.hqLocation ?? "United States"}
							</p>
						) : null}
					</div>

					<div className="space-y-1.5 text-xs">
						<div className="text-foreground flex items-center gap-2 font-medium">
							<Clock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
							<span>
								{new Date(meeting.startAt).toLocaleString([], {
									dateStyle: "medium",
									timeStyle: "short",
								})}{" "}
								<span className="text-muted-foreground font-normal">
									({meeting.timezone})
								</span>
							</span>
						</div>
						<div className="text-muted-foreground flex items-center gap-2">
							<User className="h-3.5 w-3.5 shrink-0" />
							<span className="min-w-0 truncate">
								<strong className="text-foreground font-medium">
									{contact?.fullName ?? "Founder"}
								</strong>{" "}
								({contact?.title ?? "Decision Maker"}) ·{" "}
								<span className="font-mono">{meeting.attendeeEmail}</span>
							</span>
						</div>
					</div>
				</div>

				{company ? <MeetingPrepBrief company={company} /> : null}
			</div>

			{/* Footer Actions */}
			<div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-t pt-3.5">
				<div className="flex flex-wrap items-center gap-2">
					{sanitizeExternalHttpUrl(meeting.meetingUrl) && !isCancelled ? (
						<Button asChild size="sm" variant="primary">
							<a
								href={sanitizeExternalHttpUrl(meeting.meetingUrl)}
								rel="noopener noreferrer"
								target="_blank"
							>
								<Video className="h-3.5 w-3.5" />
								<span>Join Call</span>
							</a>
						</Button>
					) : null}
					{meeting.threadId ? (
						<Button asChild size="sm" variant="outline">
							<Link href={`/dashboard/inbox?threadId=${meeting.threadId}`}>
								<Inbox className="h-3.5 w-3.5" />
								<span>Open Thread</span>
							</Link>
						</Button>
					) : null}
				</div>

				{company ? (
					<Button asChild size="sm" variant="ghost">
						<Link href={`/dashboard/companies?companyId=${company.id}`}>
							Full Brief →
						</Link>
					</Button>
				) : null}
			</div>
		</div>
	);
}

export default function MeetingsPage() {
	const {
		data: entries = [],
		error,
		isError,
		isLoading,
		refetch,
	} = useSdrMeetings();
	const nowMs = Date.now();
	const upcomingEntries = entries.filter(
		(entry) =>
			entry.meeting.status !== "cancelled" &&
			entry.meeting.status !== "completed" &&
			new Date(entry.meeting.startAt).getTime() >= nowMs
	);
	const pastEntries = entries.filter(
		(entry) => !upcomingEntries.includes(entry)
	);
	const upcomingGroups = groupMeetingsByDay(upcomingEntries);

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-6">
			<div className="border-border/70 flex flex-col justify-between gap-3 border-b pb-5 sm:flex-row sm:items-center">
				<div className="min-w-0 flex-1 space-y-1">
					<h1 className="text-foreground text-2xl font-bold tracking-tight">
						Booked Discovery Calls
					</h1>
					<p className="text-muted-foreground max-w-2xl text-sm">
						Qualified e-commerce founders who booked a 15-minute bookkeeping &
						inventory reconciliation walkthrough.
					</p>
				</div>

				<div className="text-muted-foreground flex shrink-0 items-center gap-2 font-mono text-xs whitespace-nowrap">
					<span className="text-foreground font-semibold">
						{upcomingEntries.length}
					</span>
					<span>upcoming</span>
					{pastEntries.length > 0 ? (
						<>
							<span>·</span>
							<span>{pastEntries.length} past</span>
						</>
					) : null}
				</div>
			</div>

			{isLoading ? (
				<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
					Loading scheduled calls…
				</div>
			) : null}

			{!isLoading && isError ? (
				<div className="border-border/70 bg-card space-y-3 rounded-xl border p-8 text-center text-sm">
					<p className="text-rose-600 dark:text-rose-400">
						{error instanceof Error
							? error.message
							: "Failed to load booked discovery calls."}
					</p>
					<Button
						onClick={() => void refetch()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}

			{!(isLoading || isError) && entries.length === 0 ? (
				<div className="border-border/70 bg-card space-y-3 rounded-xl border p-10 text-center">
					<CalendarCheck className="text-muted-foreground mx-auto h-8 w-8" />
					<h2 className="text-foreground text-base font-semibold">
						No Booked Discovery Calls Yet
					</h2>
					<p className="text-muted-foreground mx-auto max-w-md text-xs">
						Use the Prospect Reply Simulator in the Inbox to confirm a call slot
						and watch it appear here automatically.
					</p>
					<Button asChild size="sm" variant="primary">
						<Link href="/dashboard/inbox">Open Inbox Simulator</Link>
					</Button>
				</div>
			) : null}

			{!isLoading && upcomingGroups.length > 0 ? (
				<div className="space-y-6">
					{upcomingGroups.map((group) => (
						<section className="space-y-3" key={group.dayKey}>
							<div className="flex items-center justify-between">
								<h2 className="text-foreground text-sm font-semibold">
									{group.dayLabel}
								</h2>
								<span className="text-muted-foreground font-mono text-xs">
									{group.entries.length}{" "}
									{group.entries.length === 1 ? "call" : "calls"}
								</span>
							</div>
							<div className="space-y-4">
								{group.entries.map((entry) => (
									<MeetingCard key={entry.meeting.id} {...entry} />
								))}
							</div>
						</section>
					))}
				</div>
			) : null}

			{!isLoading && pastEntries.length > 0 ? (
				<section className="border-border/70 space-y-3 border-t pt-6">
					<div className="flex items-center justify-between">
						<h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
							Past & Closed Discovery Calls ({pastEntries.length})
						</h2>
					</div>
					<div className="space-y-4 opacity-90">
						{pastEntries.map((entry) => (
							<MeetingCard key={entry.meeting.id} {...entry} />
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}

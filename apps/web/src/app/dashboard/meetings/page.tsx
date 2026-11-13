"use client";

import { Button } from "@workspace/ui/components/button";
import {
	CalendarCheck,
	Clock,
	ExternalLink,
	Inbox,
	User,
	Video,
} from "lucide-react";
import Link from "next/link";
import type {
	SdrCompanySummary,
	SdrMeetingItem,
} from "@/lib/sdr-fallback-data";
import { useSdrMeetings } from "@/lib/sdr-hooks";
import { SignalChip, TierBadge } from "../_components/sdr-badges";

interface MeetingRowEntry {
	company: SdrCompanySummary | null;
	contact: SdrCompanySummary["primaryContact"];
	meeting: SdrMeetingItem;
}

export default function MeetingsPage() {
	const { data: rawMeetings = [], isLoading } = useSdrMeetings();
	const entries = rawMeetings as unknown as MeetingRowEntry[];

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-foreground text-2xl font-bold tracking-tight">
						Booked Discovery Calls (Cal.com)
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						Qualified e-commerce founders who booked a 15-minute bookkeeping &
						inventory reconciliation walkthrough.
					</p>
				</div>

				<div className="flex items-center gap-2">
					<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
						{entries.length} scheduled
					</span>
				</div>
			</div>

			{isLoading ? (
				<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
					Loading scheduled calls…
				</div>
			) : null}

			{!isLoading && entries.length === 0 ? (
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

			{!isLoading && entries.length > 0 ? (
				<div className="grid gap-5 md:grid-cols-2">
					{entries.map(({ company, contact, meeting }) => (
						<div
							className="border-border/70 bg-card flex flex-col justify-between space-y-4 rounded-xl border p-6 shadow-2xs"
							key={meeting.id}
						>
							<div className="space-y-3">
								<div className="flex items-start justify-between gap-3">
									<div>
										<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
											<CalendarCheck className="h-3.5 w-3.5" />
											<span>Scheduled · {meeting.status}</span>
										</span>
										<h2 className="text-foreground mt-2 text-lg font-bold">
											{meeting.title}
										</h2>
										<p className="text-muted-foreground font-mono text-xs">
											{company?.domain} ·{" "}
											{company?.hqLocation ?? "United States"}
										</p>
									</div>

									{company ? (
										<TierBadge score={company.score} tier={company.tier} />
									) : null}
								</div>

								{/* Schedule & Attendee Box */}
								<div className="border-border/70 bg-background/60 space-y-2 rounded-lg border p-3.5 text-xs">
									<div className="text-foreground flex items-center gap-2 font-medium">
										<Clock className="text-primary h-4 w-4" />
										<span>
											{new Date(meeting.startAt).toLocaleString([], {
												dateStyle: "full",
												timeStyle: "short",
											})}{" "}
											({meeting.timezone})
										</span>
									</div>
									<div className="text-muted-foreground flex items-center gap-2">
										<User className="text-muted-foreground h-4 w-4" />
										<span>
											Attendee:{" "}
											<strong className="text-foreground">
												{contact?.fullName ?? "Founder"}
											</strong>{" "}
											({contact?.title ?? "Decision Maker"}) ·{" "}
											<span className="font-mono">{meeting.attendeeEmail}</span>
										</span>
									</div>
									{meeting.meetingUrl ? (
										<div className="flex items-center gap-2 pt-1">
											<Video className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
											<a
												className="text-primary inline-flex items-center gap-1 font-mono hover:underline"
												href={meeting.meetingUrl}
												rel="noopener noreferrer"
												target="_blank"
											>
												<span>{meeting.meetingUrl}</span>
												<ExternalLink className="h-3 w-3" />
											</a>
										</div>
									) : null}
								</div>

								{/* AE Prep Context */}
								{company ? (
									<div className="space-y-2">
										<div className="text-foreground text-xs font-semibold">
											AE Call Prep Brief (Qualification Summary)
										</div>
										<p className="text-muted-foreground text-xs">
											{company.summary}
										</p>
										<div className="flex flex-wrap gap-1">
											{company.signals.map((sig) => (
												<SignalChip key={sig} signal={sig} />
											))}
										</div>
									</div>
								) : null}
							</div>

							<div className="border-border/70 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
								{meeting.threadId ? (
									<Button asChild size="sm" variant="outline">
										<Link
											href={`/dashboard/inbox?threadId=${meeting.threadId}`}
										>
											<Inbox className="h-3.5 w-3.5" />
											<span>View Conversation Thread</span>
										</Link>
									</Button>
								) : null}

								{company ? (
									<Button asChild size="sm" variant="ghost">
										<Link href={`/dashboard/companies?companyId=${company.id}`}>
											Full Evidence Brief →
										</Link>
									</Button>
								) : null}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

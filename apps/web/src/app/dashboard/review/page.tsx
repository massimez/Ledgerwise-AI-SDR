"use client";

import {
	countEmailWords,
	detectOutboundPriceViolation,
	hasUrlLink,
	sanitizeExternalHttpUrl,
} from "@workspace/ai-core/contracts";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ExternalLink,
	FileCheck2,
	Send,
	ShieldCheck,
	X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type SdrReviewQueueItem,
	useSdrReviewMutations,
	useSdrReviewQueue,
} from "@/lib/sdr-hooks";
import { SignalChip, TierBadge } from "../_components/sdr-badges";

function formatApproveButtonLabel(
	isApproving: boolean,
	isModified: boolean
): string {
	if (isApproving) {
		return "Queueing Send…";
	}
	if (isModified) {
		return "Save Edits & Approve Send";
	}
	return "Approve & Send First Email";
}

function ReviewDraftsSidebar({
	activeItem,
	items,
	onSelectMessage,
}: {
	activeItem: SdrReviewQueueItem | null;
	items: SdrReviewQueueItem[];
	onSelectMessage: (id: string) => void;
}) {
	return (
		<div className="min-w-0 space-y-2 lg:sticky lg:top-6 lg:col-span-5">
			<div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
				Pending Drafts ({items.length})
			</div>
			<div className="custom-scrollbar max-h-[55vh] space-y-2 overflow-y-auto p-0.5 pr-1.5 lg:max-h-[calc(100vh-16rem)]">
				{items.map((item) => {
					const isSelected = item.message.id === activeItem?.message.id;
					return (
						<button
							className={cn(
								"w-full rounded-xl border p-3.5 text-left transition-all",
								isSelected
									? "border-primary bg-card ring-primary/25 shadow-xs ring-1"
									: "border-border/70 bg-card/70 hover:bg-card"
							)}
							key={item.message.id}
							onClick={() => onSelectMessage(item.message.id)}
							type="button"
						>
							<div className="flex items-start justify-between gap-2">
								<div>
									<div className="text-foreground text-sm font-semibold">
										{item.company.name}
									</div>
									<div className="text-muted-foreground text-xs">
										To: {item.contact?.fullName} ({item.contact?.title})
									</div>
								</div>
								<TierBadge
									score={item.company.score}
									tier={item.company.tier}
								/>
							</div>
							<div className="text-foreground/85 mt-2 truncate font-mono text-xs">
								Subject: {item.message.subject}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function ReviewQualificationCard({
	activeItem,
}: {
	activeItem: SdrReviewQueueItem;
}) {
	return (
		<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5">
			<div className="border-border/70 space-y-1 border-b pb-3">
				<div className="flex items-center justify-between">
					<h2 className="text-foreground text-sm font-semibold">
						Why {activeItem.company.name} Qualified
					</h2>
					<Link
						className="text-primary text-xs font-medium hover:underline"
						href={`/dashboard/companies?companyId=${activeItem.company.id}`}
					>
						Full Score →
					</Link>
				</div>
				<p className="text-muted-foreground text-xs">
					{activeItem.company.summary}
				</p>
				<div className="flex flex-wrap gap-1 pt-1.5">
					{activeItem.company.signals.map((sig) => (
						<SignalChip key={sig} signal={sig} />
					))}
				</div>
			</div>

			<div className="space-y-2.5">
				<div className="flex items-center justify-between">
					<span className="text-foreground text-xs font-semibold">
						Fact-Checked Claims & Verbatim Evidence
					</span>
					<span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
						<ShieldCheck className="h-3.5 w-3.5" />
						<span>100% Grounded</span>
					</span>
				</div>

				{activeItem.message.citations.map((citation) => {
					const ev = activeItem.evidence.find(
						(e) => e.id === citation.evidenceId
					);
					return (
						<div
							className="space-y-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs"
							key={`${citation.evidenceId}-${citation.span}`}
						>
							<div className="text-foreground font-medium">
								Claim in draft:{" "}
								<span className="underline decoration-emerald-500/60 decoration-wavy">
									“{citation.span}”
								</span>
							</div>
							{ev ? (
								<div className="border-border/60 text-muted-foreground space-y-1 border-t pt-1.5 text-[11px]">
									<div className="flex items-center justify-between">
										<span className="text-foreground/85 font-semibold">
											Source: {ev.title ?? ev.claim}
										</span>
										{sanitizeExternalHttpUrl(ev.url) ? (
											<a
												className="text-primary inline-flex items-center gap-0.5 font-mono hover:underline"
												href={sanitizeExternalHttpUrl(ev.url)}
												rel="noopener noreferrer"
												target="_blank"
											>
												<span>Verify</span>
												<ExternalLink className="h-2.5 w-2.5" />
											</a>
										) : null}
									</div>
									<blockquote className="italic">“{ev.quote}”</blockquote>
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ReviewDraftEditor({
	activeItem,
	editedBody,
	editedSubject,
	isApproving,
	isRejecting,
	onApprove,
	onBodyChange,
	onReject,
	onResetEdits,
	onSubjectChange,
}: {
	activeItem: SdrReviewQueueItem;
	editedBody: string;
	editedSubject: string;
	isApproving: boolean;
	isRejecting: boolean;
	onApprove: () => void;
	onBodyChange: (value: string) => void;
	onReject: (reason: string) => void;
	onResetEdits: () => void;
	onSubjectChange: (value: string) => void;
}) {
	const [showRejectBox, setShowRejectBox] = useState(false);
	const [rejectReason, setRejectReason] = useState("");

	const citedSpans = activeItem.message.citations.map((c) => c.span);
	const wordCount = countEmailWords(editedBody);
	const priceViolated =
		detectOutboundPriceViolation(
			`${editedSubject}\n${editedBody}`,
			citedSpans
		) !== null;
	const linkViolated = hasUrlLink(editedBody);
	const wordLimitOk = wordCount > 0 && wordCount < 100;
	const isModified =
		editedSubject !== activeItem.message.subject ||
		editedBody !== activeItem.message.bodyText;

	return (
		<div className="border-border/70 bg-card space-y-4 rounded-xl border p-6">
			{/* Safety Guard Pills */}
			<div className="border-border/70 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={cn(
							"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-medium tabular-nums",
							wordLimitOk
								? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
								: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
						)}
					>
						<FileCheck2 className="h-3.5 w-3.5" />
						<span>{wordCount}/100 words</span>
					</span>

					<span
						className={cn(
							"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
							priceViolated
								? "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300"
								: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
						)}
					>
						{priceViolated ? (
							<>
								<AlertTriangle className="h-3.5 w-3.5" />
								<span>Price Detected (Blocked)</span>
							</>
						) : (
							<>
								<Check className="h-3.5 w-3.5" />
								<span>Zero Pricing Guard Passed</span>
							</>
						)}
					</span>

					<span
						className={cn(
							"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
							linkViolated
								? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
								: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
						)}
					>
						<span>
							{linkViolated
								? "Contains Link (First Email Prefers 0 Links)"
								: "Plain Text · 0 Links"}
						</span>
					</span>
				</div>
			</div>

			{/* Recipient Metadata */}
			<div className="border-border/60 bg-background/50 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
				<div>
					<span className="text-muted-foreground">To: </span>
					<span className="text-foreground font-semibold">
						{activeItem.contact?.fullName} &lt;{activeItem.contact?.email}&gt;
					</span>
				</div>
				<div>
					<span className="text-muted-foreground">Role & TZ: </span>
					<span className="text-foreground font-mono">
						{activeItem.contact?.title} ({activeItem.thread.prospectTimezone})
					</span>
				</div>
			</div>

			<div className="space-y-1.5">
				<label
					className="text-foreground block text-xs font-semibold"
					htmlFor="review-subject-input"
				>
					Subject Line
				</label>
				<input
					className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none"
					id="review-subject-input"
					onChange={(e) => onSubjectChange(e.target.value)}
					type="text"
					value={editedSubject}
				/>
			</div>

			<div className="space-y-1.5">
				<label
					className="text-foreground block text-xs font-semibold"
					htmlFor="review-body-input"
				>
					Conversational Plain-Text Body (No physical address footer)
				</label>
				<textarea
					className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border p-3.5 font-sans text-sm leading-relaxed focus:outline-none"
					id="review-body-input"
					onChange={(e) => onBodyChange(e.target.value)}
					rows={10}
					value={editedBody}
				/>
			</div>

			{priceViolated ? (
				<div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200">
					<strong>Ledgerwise Pricing Invariant Violation:</strong> Pricing is
					discussed only on a discovery call. Remove dollar amounts or monthly
					fee references to enable sending.
				</div>
			) : null}

			{showRejectBox ? (
				<div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3.5">
					<label
						className="text-foreground block text-xs font-semibold"
						htmlFor="reject-reason-input"
					>
						Reason for rejecting this draft
					</label>
					<input
						className="border-border bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-xs"
						id="reject-reason-input"
						onChange={(e) => setRejectReason(e.target.value)}
						placeholder="e.g., Wrong contact persona or weak timing trigger…"
						type="text"
						value={rejectReason}
					/>
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => setShowRejectBox(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={isRejecting}
							onClick={() => {
								onReject(
									rejectReason.trim() ||
										"Rejected by human reviewer in Review Queue"
								);
								setShowRejectBox(false);
							}}
							size="sm"
							type="button"
							variant="destructive"
						>
							Confirm Reject
						</Button>
					</div>
				</div>
			) : null}

			{/* Action Footer */}
			<div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
				<Button
					disabled={isApproving || isRejecting}
					onClick={() => setShowRejectBox((prev) => !prev)}
					size="sm"
					type="button"
					variant="outline"
				>
					<X className="h-4 w-4 text-rose-500" />
					<span>Reject Draft</span>
				</Button>

				<div className="flex items-center gap-2">
					{isModified ? (
						<Button
							onClick={onResetEdits}
							size="sm"
							type="button"
							variant="ghost"
						>
							Reset Edits
						</Button>
					) : null}

					<Button
						disabled={isApproving || isRejecting || priceViolated}
						onClick={onApprove}
						size="sm"
						type="button"
						variant="primary"
					>
						<Send className="h-3.5 w-3.5" />
						<span>{formatApproveButtonLabel(isApproving, isModified)}</span>
					</Button>
				</div>
			</div>
		</div>
	);
}

export default function ReviewQueuePage() {
	const {
		data: items = [],
		error,
		isError,
		isLoading,
		refetch,
	} = useSdrReviewQueue();
	const { approveEmail, rejectEmail, isApproving, isRejecting } =
		useSdrReviewMutations();

	const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
		null
	);
	const [editedSubject, setEditedSubject] = useState("");
	const [editedBody, setEditedBody] = useState("");
	const lastSyncedMessageIdRef = useRef<string | null>(null);

	const activeItem = useMemo(() => {
		if (
			selectedMessageId &&
			items.some((item) => item.message.id === selectedMessageId)
		) {
			return (
				items.find((item) => item.message.id === selectedMessageId) ?? null
			);
		}
		return items[0] ?? null;
	}, [items, selectedMessageId]);

	useEffect(() => {
		if (!activeItem) {
			lastSyncedMessageIdRef.current = null;
			return;
		}
		if (lastSyncedMessageIdRef.current !== activeItem.message.id) {
			lastSyncedMessageIdRef.current = activeItem.message.id;
			setEditedSubject(activeItem.message.subject);
			setEditedBody(activeItem.message.bodyText);
		}
	}, [activeItem]);

	const handleApprove = async () => {
		if (!activeItem) {
			return;
		}
		try {
			await approveEmail({
				bodyText: editedBody,
				citedSpans: activeItem.message.citations.map((c) => c.span),
				messageId: activeItem.message.id,
				subject: editedSubject,
			});
		} catch {
			// Surfaced to user by mutation onError toast
		}
	};

	const handleReject = async (reason: string) => {
		if (!activeItem) {
			return;
		}
		try {
			await rejectEmail({
				messageId: activeItem.message.id,
				reason,
			});
		} catch {
			// Surfaced to user by mutation onError toast
		}
	};

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-foreground text-2xl font-bold tracking-tight">
						First-Touch Outreach Review Queue
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						Human-in-the-loop gate: every first email is verified against
						scraped evidence, checked for &lt;100 words, and blocked if any
						pricing appears.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs font-semibold text-amber-700 dark:text-amber-300">
						{items.length} awaiting approval
					</span>
				</div>
			</div>

			{isLoading ? (
				<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
					Loading review queue…
				</div>
			) : null}

			{!isLoading && isError ? (
				<div className="border-border/70 bg-card space-y-3 rounded-xl border p-8 text-center text-sm">
					<p className="text-rose-600 dark:text-rose-400">
						{error instanceof Error
							? error.message
							: "Failed to load review queue."}
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

			{!(isLoading || isError) && items.length === 0 ? (
				<div className="border-border/70 bg-card space-y-4 rounded-xl border p-10 text-center">
					<div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
						<CheckCircle2 className="h-5 w-5" />
					</div>
					<div className="space-y-1">
						<h2 className="text-foreground text-base font-semibold">
							Review Queue is Clear
						</h2>
						<p className="text-muted-foreground mx-auto max-w-md text-xs">
							All first-touch outreach drafts have been reviewed. Head to the
							Inbox to monitor active prospect conversations or simulate inbound
							replies.
						</p>
					</div>
					<div className="flex justify-center gap-2 pt-2">
						<Button asChild size="sm" variant="primary">
							<Link href="/dashboard/inbox">Open Inbox</Link>
						</Button>
						<Button asChild size="sm" variant="outline">
							<Link href="/dashboard/companies">View Companies</Link>
						</Button>
					</div>
				</div>
			) : null}

			{!isLoading && items.length > 0 ? (
				<div className="grid items-start gap-6 lg:grid-cols-12">
					<ReviewDraftsSidebar
						activeItem={activeItem}
						items={items}
						onSelectMessage={setSelectedMessageId}
					/>
					{activeItem ? (
						<div className="min-w-0 space-y-6 lg:col-span-7">
							<ReviewDraftEditor
								activeItem={activeItem}
								editedBody={editedBody}
								editedSubject={editedSubject}
								isApproving={isApproving}
								isRejecting={isRejecting}
								onApprove={() => void handleApprove()}
								onBodyChange={setEditedBody}
								onReject={(reason) => void handleReject(reason)}
								onResetEdits={() => {
									setEditedSubject(activeItem.message.subject);
									setEditedBody(activeItem.message.bodyText);
								}}
								onSubjectChange={setEditedSubject}
							/>
							<ReviewQualificationCard activeItem={activeItem} />
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

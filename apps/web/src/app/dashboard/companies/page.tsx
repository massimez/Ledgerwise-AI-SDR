"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	type DiscoveryNicheId,
	sanitizeExternalHttpUrl,
} from "@workspace/ai-core/contracts";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	CheckCircle2,
	ExternalLink,
	Eye,
	EyeOff,
	HelpCircle,
	Inbox,
	Search,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
	useDiscoverLeadsMutation,
	useInfiniteSdrCompanies,
	useSdrCompanyDetail,
	useSdrResearchRuns,
	useToggleCompanyHiddenMutation,
} from "@/lib/sdr-hooks";
import type {
	CompanyTier,
	CriterionVerdict,
	SdrCompanySort,
	SdrCompanySummary,
	SdrCriterionItem,
	SdrDiscoverySignalPreset,
	SdrEvidenceItem,
	SdrThreadItem,
} from "@/lib/sdr-types";
import {
	SignalChip,
	ThreadStateBadge,
	TierBadge,
} from "../_components/sdr-badges";
import { DiscoverLeadsDialog } from "./_components/discover-leads-dialog";
import { DiscoveryRunBanner } from "./_components/discovery-run-banner";

const CRITERION_LABELS: Record<string, string> = {
	decision_maker_found: "Decision Maker Found (Founder / COO / Finance)",
	ecommerce_brand: "Physical E-Commerce Brand (Shopify / Amazon / DTC)",
	employees_5_50: "Employee Headcount Fit (5–50 FTEs)",
	enterprise_disqualifier: "Enterprise / Public / Non-Ecom Disqualifier Check",
	revenue_1m_10m: "Annual Revenue Fit ($1M–$10M GMV)",
	signal_channel_expansion: "Omnichannel Expansion Signal (Amazon / Wholesale)",
	signal_hiring_finance_ops: "Hiring Finance / Bookkeeping / Ops Signal",
	signal_recent_funding: "Recent Seed / Growth Funding Signal",
	us_based: "US-Based Entity & Operations",
};

const SIGNAL_FILTERS = [
	"Hiring",
	"Seed",
	"Wholesale",
	"Amazon",
	"Shopify",
] as const;

const SORT_OPTIONS: ReadonlyArray<{ label: string; value: SdrCompanySort }> = [
	{ label: "Highest score", value: "score_desc" },
	{ label: "Lowest score", value: "score_asc" },
	{ label: "Newest added", value: "recent" },
	{ label: "Oldest added", value: "oldest" },
	{ label: "Name (A–Z)", value: "name_asc" },
];

const COMPANIES_PAGE_SIZE = 10;

function formatCreatedDateTime(
	isoDate: string | null | undefined
): string | null {
	if (!isoDate) {
		return null;
	}
	const parsed = new Date(isoDate);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		month: "short",
		year: "numeric",
	}).format(parsed);
}

function formatTierTabLabel(tier: CompanyTier | "all"): string {
	if (tier === "all") {
		return "All Tiers";
	}
	if (tier === "DQ") {
		return "Disqualified";
	}
	return `Tier ${tier}`;
}

function CriterionVerdictIcon({ verdict }: { verdict: CriterionVerdict }) {
	if (verdict === "met") {
		return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
	}
	if (verdict === "unknown") {
		return <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />;
	}
	return <XCircle className="h-4 w-4 shrink-0 text-rose-500" />;
}

function CompanyThreadAction({
	thread,
}: {
	thread: SdrThreadItem | undefined;
}) {
	if (!thread) {
		return null;
	}
	if (thread.status === "awaiting_review") {
		return (
			<Button asChild size="sm" variant="primary">
				<Link href="/dashboard/review">
					<span>Review First Email</span>
				</Link>
			</Button>
		);
	}
	return (
		<Button asChild size="sm" variant="outline">
			<Link href={`/dashboard/inbox?threadId=${thread.id}`}>
				<Inbox className="h-3.5 w-3.5" />
				<span>Open Thread</span>
			</Link>
		</Button>
	);
}

function CompanyListCard({
	company,
	isSelected,
	onSelect,
}: {
	company: SdrCompanySummary;
	isSelected: boolean;
	onSelect: (id: string) => void;
}) {
	const createdLabel = formatCreatedDateTime(company.createdAt);

	return (
		<button
			className={cn(
				"w-full rounded-xl border p-4 text-left transition-all",
				isSelected
					? "border-primary bg-card ring-primary/25 shadow-xs ring-1"
					: "border-border/70 bg-card/70 hover:border-border hover:bg-card",
				company.hidden && "opacity-75"
			)}
			onClick={() => onSelect(company.id)}
			type="button"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-foreground truncate text-sm font-semibold">
							{company.name}
						</span>
						{company.hidden ? (
							<span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
								Hidden
							</span>
						) : null}
					</div>
					<div className="text-muted-foreground font-mono text-xs">
						{company.domain} · {company.hqLocation ?? "US"}
						{createdLabel ? ` · Added ${createdLabel}` : ""}
					</div>
				</div>
				<TierBadge score={company.score} tier={company.tier} />
			</div>

			<p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
				{company.summary}
			</p>

			<div className="mt-2.5 flex flex-wrap gap-1">
				{company.signals.map((sig) => (
					<SignalChip key={sig} signal={sig} />
				))}
			</div>
		</button>
	);
}

function CompaniesListPane({
	activeCompanyId,
	companies,
	errorMessage,
	hasMore,
	isError,
	isFetchingMore,
	isLoading,
	onLoadMore,
	onRetry,
	onSelect,
	totalCount,
}: {
	activeCompanyId: string | null;
	companies: SdrCompanySummary[];
	errorMessage?: string;
	hasMore: boolean;
	isError: boolean;
	isFetchingMore: boolean;
	isLoading: boolean;
	onLoadMore: () => void;
	onRetry: () => void;
	onSelect: (id: string) => void;
	totalCount: number;
}) {
	if (isLoading) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				Loading researched companies…
			</div>
		);
	}
	if (isError) {
		return (
			<div className="border-border/70 bg-card space-y-3 rounded-xl border p-6 text-center text-sm">
				<p className="text-rose-600 dark:text-rose-400">
					{errorMessage ?? "Failed to load researched companies."}
				</p>
				<Button onClick={onRetry} size="sm" type="button" variant="outline">
					Retry
				</Button>
			</div>
		);
	}
	if (companies.length === 0) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				No companies match the active filters.
			</div>
		);
	}

	const remainingCount = Math.max(0, totalCount - companies.length);

	return (
		<>
			{companies.map((company) => (
				<CompanyListCard
					company={company}
					isSelected={company.id === activeCompanyId}
					key={company.id}
					onSelect={onSelect}
				/>
			))}
			{hasMore ? (
				<div className="pt-1 pb-2">
					<Button
						className="w-full"
						disabled={isFetchingMore}
						onClick={onLoadMore}
						size="sm"
						type="button"
						variant="outline"
					>
						{isFetchingMore
							? "Loading more…"
							: `Show more (${remainingCount} remaining)`}
					</Button>
				</div>
			) : null}
		</>
	);
}

function CompanyDetailPane({
	company,
	criteria,
	evidence,
	isTogglingHidden,
	onToggleHidden,
	threads,
}: {
	company: SdrCompanySummary;
	criteria: SdrCriterionItem[];
	evidence: SdrEvidenceItem[];
	isTogglingHidden: boolean;
	onToggleHidden: (company: SdrCompanySummary) => void;
	threads: SdrThreadItem[];
}) {
	const [primaryThread] = threads;
	const createdLabel = formatCreatedDateTime(company.createdAt);
	const dqCriterion = criteria.find(
		(c) => c.criterion === "enterprise_disqualifier" && c.verdict === "not_met"
	);

	return (
		<div className="border-border/70 bg-card space-y-6 rounded-xl border p-6">
			{/* Company Top Summary */}
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-start">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-2.5">
						<h2 className="text-foreground text-xl font-bold">
							{company.name}
						</h2>
						<TierBadge score={company.score} tier={company.tier} />
						{company.hidden ? (
							<span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-300">
								Hidden
							</span>
						) : null}
					</div>
					<div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-xs">
						<span>{company.domain}</span>
						<span>·</span>
						<span>{company.hqLocation ?? "United States"}</span>
						<span>·</span>
						<span>Rev: {company.revenueBand}</span>
						<span>·</span>
						<span>Team: {company.employeeBand}</span>
						{createdLabel ? (
							<>
								<span>·</span>
								<span>Added {createdLabel}</span>
							</>
						) : null}
					</div>
					<p className="text-foreground/90 pt-1 text-sm">{company.summary}</p>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<Button
						disabled={isTogglingHidden}
						onClick={() => onToggleHidden(company)}
						size="sm"
						type="button"
						variant="outline"
					>
						{company.hidden ? (
							<Eye className="h-3.5 w-3.5" />
						) : (
							<EyeOff className="h-3.5 w-3.5" />
						)}
						<span>{company.hidden ? "Unhide" : "Hide"}</span>
					</Button>
					<CompanyThreadAction thread={primaryThread} />
				</div>
			</div>

			{/* Disqualification Warning Banner */}
			{company.tier === "DQ" || dqCriterion ? (
				<div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200">
					<div className="font-semibold">
						Hard Disqualifier Triggered — Outreach Blocked
					</div>
					<p className="mt-0.5">{dqCriterion?.rationale ?? company.summary}</p>
				</div>
			) : null}

			{/* Qualification Rubric Breakdown */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-foreground text-sm font-semibold">
						Qualification Score Rubric (
						<span className="font-mono tabular-nums">{company.score}/100</span>)
					</h3>
					<span className="text-muted-foreground text-xs">
						Unreported private revenue/size awards 10/15 when US + E-Com gates
						pass
					</span>
				</div>

				<div className="divide-border/70 border-border/70 divide-y rounded-lg border">
					{criteria.map((crit) => {
						const isUnknownEstFit =
							crit.verdict === "unknown" && crit.points === 10;
						return (
							<div
								className="flex items-start justify-between gap-4 p-3.5 text-xs"
								key={crit.id}
							>
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<CriterionVerdictIcon verdict={crit.verdict} />
										<span className="text-foreground font-semibold">
											{CRITERION_LABELS[crit.criterion] ?? crit.criterion}
										</span>
										{isUnknownEstFit ? (
											<span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-300">
												Est. fit (unreported) · 10/15
											</span>
										) : null}
									</div>
									<p className="text-muted-foreground pl-6">{crit.rationale}</p>
								</div>

								<div className="text-foreground shrink-0 font-mono text-xs font-semibold tabular-nums">
									{crit.points}/{crit.maxPoints} pts
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Verified Evidence Snippets */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-foreground text-sm font-semibold">
						Verified Source Evidence ({evidence.length})
					</h3>
					<span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
						<ShieldCheck className="h-3.5 w-3.5" />
						<span>Verbatim quote verified against source</span>
					</span>
				</div>

				<div className="space-y-2.5">
					{evidence.map((ev) => (
						<div
							className="border-border/70 bg-background/60 space-y-1.5 rounded-lg border p-3.5 text-xs"
							key={ev.id}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase">
										{ev.kind}
									</span>
									<span className="text-foreground font-semibold">
										{ev.title ?? ev.claim}
									</span>
								</div>
								{sanitizeExternalHttpUrl(ev.url) ? (
									<a
										className="text-primary inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
										href={sanitizeExternalHttpUrl(ev.url)}
										rel="noopener noreferrer"
										target="_blank"
									>
										<span>Source</span>
										<ExternalLink className="h-3 w-3" />
									</a>
								) : null}
							</div>
							<blockquote className="border-primary/40 text-foreground/90 border-l-2 pl-3 italic">
								“{ev.quote}”
							</blockquote>
						</div>
					))}
				</div>
			</div>

			{/* Decision Maker & Thread Status */}
			{company.primaryContact ? (
				<div className="border-border/70 space-y-2.5 border-t pt-4">
					<h3 className="text-foreground text-sm font-semibold">
						Target Decision Maker & Thread State
					</h3>
					<div className="border-border/70 bg-background/50 flex flex-col justify-between gap-2 rounded-lg border p-3.5 text-xs sm:flex-row sm:items-center">
						<div>
							<div className="text-foreground font-semibold">
								{company.primaryContact.fullName}
							</div>
							<div className="text-muted-foreground">
								{company.primaryContact.title}
							</div>
							<div className="text-muted-foreground mt-0.5 font-mono text-[11px]">
								{company.primaryContact.email ?? "No email"}
							</div>
						</div>
						{primaryThread ? (
							<div className="flex items-center gap-3">
								<ThreadStateBadge status={primaryThread.status} />
								<Link
									className="text-primary font-medium hover:underline"
									href={
										primaryThread.status === "awaiting_review"
											? "/dashboard/review"
											: `/dashboard/inbox?threadId=${primaryThread.id}`
									}
								>
									Inspect →
								</Link>
							</div>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}

function CompaniesPageContent() {
	const searchParams = useSearchParams();
	const initialCompanyId = searchParams.get("companyId");
	const queryClient = useQueryClient();

	const [tierFilter, setTierFilter] = useState<CompanyTier | "all">("all");
	const [signalFilter, setSignalFilter] = useState<string | "all">("all");
	const [sortBy, setSortBy] = useState<SdrCompanySort>("score_desc");
	const [showHidden, setShowHidden] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(initialCompanyId);
	const [discoverOpen, setDiscoverOpen] = useState(false);
	const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);

	const { data: researchRuns = [] } = useSdrResearchRuns();
	const trackedRun = useMemo(() => {
		if (trackedRunId) {
			return researchRuns.find((run) => run.id === trackedRunId) ?? null;
		}
		return (
			researchRuns.find(
				(run) => run.status === "queued" || run.status === "running"
			) ?? null
		);
	}, [researchRuns, trackedRunId]);
	const discoverMutation = useDiscoverLeadsMutation();

	const lastSyncedRunSnapshotRef = useRef<string | null>(null);
	useEffect(() => {
		if (!trackedRun) {
			return;
		}
		const snapshotKey = `${trackedRun.id}:${trackedRun.status}:${trackedRun.foundCount}:${trackedRun.researchedCount}:${trackedRun.qualifiedCount}`;
		if (lastSyncedRunSnapshotRef.current === snapshotKey) {
			return;
		}
		lastSyncedRunSnapshotRef.current = snapshotKey;

		void Promise.all([
			queryClient.invalidateQueries({ queryKey: ["sdr", "companies"] }),
			queryClient.invalidateQueries({ queryKey: ["sdr", "dashboard"] }),
			queryClient.invalidateQueries({ queryKey: ["sdr", "review"] }),
		]);
	}, [queryClient, trackedRun]);

	const handleStartDiscovery = async (input: {
		keyword?: string;
		limit: number;
		niche?: DiscoveryNicheId;
		signalPreset: SdrDiscoverySignalPreset;
	}) => {
		try {
			const result = await discoverMutation.mutateAsync(input);
			setDismissedRunId(null);
			setTrackedRunId(result.run.id);
		} catch {
			// Surfaced via mutation onError toast
		}
	};

	const toggleHiddenMutation = useToggleCompanyHiddenMutation();

	const handleToggleHidden = async (company: SdrCompanySummary) => {
		const nextHidden = !company.hidden;
		try {
			await toggleHiddenMutation.mutateAsync({
				companyId: company.id,
				hidden: nextHidden,
			});
			if (nextHidden && !showHidden && selectedId === company.id) {
				setSelectedId(null);
			}
		} catch {
			// Surfaced via mutation onError toast
		}
	};

	const {
		data: companiesData,
		error: companiesError,
		fetchNextPage,
		hasNextPage,
		isError: isCompaniesError,
		isFetchingNextPage,
		isLoading,
		refetch: refetchCompanies,
	} = useInfiniteSdrCompanies({
		includeHidden: showHidden,
		limit: COMPANIES_PAGE_SIZE,
		q: searchQuery || undefined,
		signal: signalFilter === "all" ? undefined : signalFilter,
		sort: sortBy,
		tier: tierFilter === "all" ? undefined : tierFilter,
	});

	const companies = useMemo(
		() => companiesData?.pages.flatMap((page) => page.companies) ?? [],
		[companiesData]
	);
	const totalCount = companiesData?.pages[0]?.total ?? companies.length;

	const activeCompanyId = useMemo(() => {
		if (selectedId && companies.some((c) => c.id === selectedId)) {
			return selectedId;
		}
		return companies[0]?.id ?? null;
	}, [companies, selectedId]);

	const { data: detail } = useSdrCompanyDetail(activeCompanyId);

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
			<div className="border-border/70 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
				<div>
					<h1 className="text-foreground text-2xl font-bold tracking-tight">
						Researched Companies & Qualification Ledger
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						Explainable 0–100 ICP scoring with private-brand unknown size
						estimation (10/15) and verbatim source evidence.
					</p>
				</div>

				<div className="flex shrink-0 items-center">
					<Button
						className="shrink-0"
						onClick={() => setDiscoverOpen(true)}
						size="sm"
						type="button"
						variant="primary"
					>
						<span>Discover Leads</span>
					</Button>
				</div>
			</div>

			{trackedRun && trackedRun.id !== dismissedRunId ? (
				<DiscoveryRunBanner
					onDismiss={() => {
						setDismissedRunId(trackedRun.id);
						if (trackedRunId === trackedRun.id) {
							setTrackedRunId(null);
						}
					}}
					run={trackedRun}
				/>
			) : null}

			<DiscoverLeadsDialog
				isSubmitting={discoverMutation.isPending}
				onOpenChange={setDiscoverOpen}
				onSubmit={handleStartDiscovery}
				open={discoverOpen}
			/>

			{/* Filter Bar */}
			<div className="space-y-2.5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-muted-foreground mr-1 text-xs font-medium">
							Tier:
						</span>
						{(["all", "A", "B", "C", "DQ"] as const).map((tier) => (
							<button
								className={cn(
									"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
									tierFilter === tier
										? "border-primary bg-primary/10 text-foreground font-semibold"
										: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
								)}
								key={tier}
								onClick={() => setTierFilter(tier)}
								type="button"
							>
								{formatTierTabLabel(tier)}
							</button>
						))}
					</div>

					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-muted-foreground mr-1 text-xs font-medium">
							Signal:
						</span>
						<button
							className={cn(
								"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
								signalFilter === "all"
									? "border-primary bg-primary/10 text-foreground font-semibold"
									: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
							)}
							onClick={() => setSignalFilter("all")}
							type="button"
						>
							All Signals
						</button>
						{SIGNAL_FILTERS.map((sig) => (
							<button
								className={cn(
									"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
									signalFilter === sig
										? "border-primary bg-primary/10 text-foreground font-semibold"
										: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
								)}
								key={sig}
								onClick={() => setSignalFilter(sig)}
								type="button"
							>
								{sig}
							</button>
						))}
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<button
							aria-pressed={showHidden}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
								showHidden
									? "border-primary bg-primary/10 text-foreground font-semibold"
									: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
							)}
							onClick={() => setShowHidden((prev) => !prev)}
							type="button"
						>
							{showHidden ? (
								<Eye className="h-3.5 w-3.5" />
							) : (
								<EyeOff className="h-3.5 w-3.5" />
							)}
							<span>{showHidden ? "Showing hidden" : "Show hidden"}</span>
						</button>

						<label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
							<span>Sort:</span>
							<select
								aria-label="Sort companies"
								className="border-border/70 bg-card text-foreground focus:border-primary rounded-md border px-2.5 py-1 text-xs font-medium focus:outline-none"
								onChange={(e) => setSortBy(e.target.value as SdrCompanySort)}
								value={sortBy}
							>
								{SORT_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="relative w-full sm:w-64">
						<Search className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5" />
						<input
							aria-label="Search companies by name or domain"
							className="border-border/70 bg-card text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-md border py-1 pr-2.5 pl-8 text-xs focus:outline-none"
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search name, domain, summary…"
							type="search"
							value={searchQuery}
						/>
					</div>
				</div>
			</div>

			{/* Master-Detail Split */}
			<div className="grid items-start gap-6 lg:grid-cols-12">
				<div className="flex min-w-0 flex-col gap-2.5 lg:col-span-5">
					<div className="text-muted-foreground flex items-center justify-between text-xs">
						<span>
							Showing {companies.length} of {totalCount} companies
						</span>
					</div>
					<div className="space-y-2.5 lg:max-h-[calc(100vh-19rem)] lg:overflow-y-auto lg:pr-1">
						<CompaniesListPane
							activeCompanyId={activeCompanyId}
							companies={companies}
							errorMessage={
								companiesError instanceof Error
									? companiesError.message
									: undefined
							}
							hasMore={Boolean(hasNextPage)}
							isError={isCompaniesError}
							isFetchingMore={isFetchingNextPage}
							isLoading={isLoading}
							onLoadMore={() => void fetchNextPage()}
							onRetry={() => void refetchCompanies()}
							onSelect={setSelectedId}
							totalCount={totalCount}
						/>
					</div>
				</div>

				<div className="min-w-0 lg:col-span-7">
					{detail ? (
						<CompanyDetailPane
							company={detail.company as SdrCompanySummary}
							criteria={detail.criteria as SdrCriterionItem[]}
							evidence={detail.evidence as SdrEvidenceItem[]}
							isTogglingHidden={
								toggleHiddenMutation.isPending &&
								toggleHiddenMutation.variables?.companyId === detail.company.id
							}
							onToggleHidden={(company) => void handleToggleHidden(company)}
							threads={detail.threads as SdrThreadItem[]}
						/>
					) : (
						<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
							Select a company on the left to inspect its qualification rubric
							and verified source evidence.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default function CompaniesPage() {
	return (
		<Suspense
			fallback={
				<div className="text-muted-foreground mx-auto max-w-6xl p-8 text-sm">
					Loading companies…
				</div>
			}
		>
			<CompaniesPageContent />
		</Suspense>
	);
}

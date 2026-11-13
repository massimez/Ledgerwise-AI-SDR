"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	CheckCircle2,
	ExternalLink,
	HelpCircle,
	Inbox,
	Search,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import type {
	CompanyTier,
	CriterionVerdict,
	SdrCompanySummary,
	SdrCriterionItem,
	SdrEvidenceItem,
	SdrThreadItem,
} from "@/lib/sdr-fallback-data";
import { useSdrCompanies, useSdrCompanyDetail } from "@/lib/sdr-hooks";
import {
	SignalChip,
	ThreadStateBadge,
	TierBadge,
} from "../_components/sdr-badges";

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

function CompaniesListPane({
	activeCompanyId,
	companies,
	isLoading,
	onSelect,
}: {
	activeCompanyId: string | null;
	companies: SdrCompanySummary[];
	isLoading: boolean;
	onSelect: (id: string) => void;
}) {
	if (isLoading) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-6 text-center text-sm">
				Loading researched companies…
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
	return (
		<>
			{companies.map((company) => {
				const isSelected = company.id === activeCompanyId;
				return (
					<button
						className={cn(
							"w-full rounded-xl border p-4 text-left transition-all",
							isSelected
								? "border-primary bg-card ring-primary/25 shadow-xs ring-1"
								: "border-border/70 bg-card/70 hover:border-border hover:bg-card"
						)}
						key={company.id}
						onClick={() => onSelect(company.id)}
						type="button"
					>
						<div className="flex items-start justify-between gap-2">
							<div>
								<div className="text-foreground text-sm font-semibold">
									{company.name}
								</div>
								<div className="text-muted-foreground font-mono text-xs">
									{company.domain} · {company.hqLocation ?? "US"}
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
			})}
		</>
	);
}

function CompanyDetailPane({
	company,
	criteria,
	evidence,
	threads,
}: {
	company: SdrCompanySummary;
	criteria: SdrCriterionItem[];
	evidence: SdrEvidenceItem[];
	threads: SdrThreadItem[];
}) {
	const [primaryThread] = threads;
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
					</div>
					<div className="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-xs">
						<span>{company.domain}</span>
						<span>·</span>
						<span>{company.hqLocation ?? "United States"}</span>
						<span>·</span>
						<span>Rev: {company.revenueBand}</span>
						<span>·</span>
						<span>Team: {company.employeeBand}</span>
					</div>
					<p className="text-foreground/90 pt-1 text-sm">{company.summary}</p>
				</div>

				<div className="flex shrink-0 flex-wrap gap-2">
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
								<a
									className="text-primary inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
									href={ev.url}
									rel="noopener noreferrer"
									target="_blank"
								>
									<span>Source</span>
									<ExternalLink className="h-3 w-3" />
								</a>
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

	const [tierFilter, setTierFilter] = useState<CompanyTier | "all">("all");
	const [signalFilter, setSignalFilter] = useState<string | "all">("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(initialCompanyId);

	const { data: companies = [], isLoading } = useSdrCompanies({
		q: searchQuery || undefined,
		signal: signalFilter === "all" ? undefined : signalFilter,
		tier: tierFilter === "all" ? undefined : tierFilter,
	});

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

				<div className="relative w-full sm:w-72">
					<Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
					<input
						aria-label="Search companies by name or domain"
						className="border-border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-lg border py-2 pr-3 pl-9 text-xs focus:outline-none"
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search name, domain, summary…"
						type="search"
						value={searchQuery}
					/>
				</div>
			</div>

			{/* Filter Bar */}
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

			{/* Master-Detail Split */}
			<div className="grid gap-6 lg:grid-cols-12">
				<div className="space-y-2.5 lg:col-span-5">
					<CompaniesListPane
						activeCompanyId={activeCompanyId}
						companies={companies}
						isLoading={isLoading}
						onSelect={setSelectedId}
					/>
				</div>

				<div className="lg:col-span-7">
					{detail ? (
						<CompanyDetailPane
							company={detail.company as SdrCompanySummary}
							criteria={detail.criteria as SdrCriterionItem[]}
							evidence={detail.evidence as SdrEvidenceItem[]}
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

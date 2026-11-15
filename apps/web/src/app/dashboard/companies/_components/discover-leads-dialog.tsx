"use client";

import {
	DISCOVERY_NICHES,
	type DiscoveryNicheId,
} from "@workspace/ai-core/contracts";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import {
	Briefcase,
	Loader2,
	Rocket,
	Sparkles,
	Store,
	TrendingUp,
} from "lucide-react";
import { useId, useState } from "react";
import type { SdrDiscoverySignalPreset } from "@/lib/sdr-types";

const SIGNAL_PRESET_OPTIONS: Array<{
	description: string;
	icon: typeof Briefcase;
	id: SdrDiscoverySignalPreset;
	label: string;
}> = [
	{
		description:
			"Brands actively hiring accountants, controllers, bookkeepers, or ecommerce ops leads.",
		icon: Briefcase,
		id: "hiring_finance_ops",
		label: "Hiring Finance / Ops",
	},
	{
		description:
			"US DTC brands that recently raised seed, Series A, or growth capital.",
		icon: TrendingUp,
		id: "recent_funding",
		label: "Recent Funding",
	},
	{
		description:
			"Brands expanding into Amazon FBA, wholesale retail, or multi-warehouse 3PL.",
		icon: Store,
		id: "channel_expansion",
		label: "Channel Expansion",
	},
];

const BATCH_SIZE_OPTIONS = [3, 5, 10] as const;

interface DiscoverLeadsDialogProps {
	isSubmitting: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (input: {
		keyword?: string;
		limit: number;
		niche?: DiscoveryNicheId;
		signalPreset: SdrDiscoverySignalPreset;
	}) => Promise<void>;
	open: boolean;
}

export function DiscoverLeadsDialog({
	isSubmitting,
	onOpenChange,
	onSubmit,
	open,
}: DiscoverLeadsDialogProps) {
	const keywordInputId = useId();
	const [signalPreset, setSignalPreset] =
		useState<SdrDiscoverySignalPreset>("hiring_finance_ops");
	const [niche, setNiche] = useState<DiscoveryNicheId | undefined>(undefined);
	const [keyword, setKeyword] = useState("");
	const [limit, setLimit] = useState<number>(5);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		try {
			await onSubmit({
				keyword: keyword.trim() || undefined,
				limit,
				niche,
				signalPreset,
			});
			onOpenChange(false);
		} catch {
			// Toast is handled by mutation onError
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-lg font-bold">
						<Sparkles className="text-primary h-4 w-4" />
						<span>Discover New E-Commerce Leads</span>
					</DialogTitle>
					<DialogDescription className="text-xs leading-relaxed">
						Run an on-demand Exa + AI research batch. Qualified Tier A/B brands
						will automatically generate verified first-touch drafts in your
						Review Queue.
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-5 py-1" onSubmit={handleSubmit}>
					<fieldset className="space-y-2">
						<legend className="text-foreground text-xs font-semibold">
							1. Select Timing Signal Preset
						</legend>
						<div className="grid gap-2">
							{SIGNAL_PRESET_OPTIONS.map((option) => {
								const Icon = option.icon;
								const isSelected = signalPreset === option.id;
								return (
									<button
										aria-pressed={isSelected}
										className={cn(
											"flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
											isSelected
												? "border-primary bg-primary/5 ring-primary/25 ring-1"
												: "border-border/70 bg-card hover:bg-muted/40"
										)}
										key={option.id}
										onClick={() => setSignalPreset(option.id)}
										type="button"
									>
										<div
											className={cn(
												"mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
												isSelected
													? "border-primary/40 bg-primary/10 text-primary"
													: "border-border/70 bg-muted/40 text-muted-foreground"
											)}
										>
											<Icon className="h-3.5 w-3.5" />
										</div>
										<div className="min-w-0 space-y-0.5">
											<div className="text-foreground text-xs font-semibold">
												{option.label}
											</div>
											<p className="text-muted-foreground text-[11px] leading-snug">
												{option.description}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</fieldset>

					<fieldset className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<legend className="text-foreground text-xs font-semibold">
								2. Target Vertical Niche
							</legend>
							<span className="text-muted-foreground text-[11px]">
								{niche ? "Pinned vertical" : "Auto-rotates 8 verticals"}
							</span>
						</div>
						<div className="flex flex-wrap gap-1.5">
							<button
								aria-pressed={niche === undefined}
								className={cn(
									"rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
									niche === undefined
										? "border-primary bg-primary/10 text-foreground ring-primary/25 ring-1"
										: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
								)}
								onClick={() => setNiche(undefined)}
								type="button"
							>
								Auto (Rotate Niches)
							</button>
							{DISCOVERY_NICHES.map((item) => {
								const isSelected = niche === item.id;
								return (
									<button
										aria-pressed={isSelected}
										className={cn(
											"rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
											isSelected
												? "border-primary bg-primary/10 text-foreground ring-primary/25 ring-1"
												: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
										)}
										key={item.id}
										onClick={() =>
											setNiche((prev) =>
												prev === item.id ? undefined : item.id
											)
										}
										type="button"
									>
										{item.label}
									</button>
								);
							})}
						</div>
					</fieldset>

					<div className="space-y-1.5">
						<Label className="text-xs font-semibold" htmlFor={keywordInputId}>
							3. Optional Niche Keyword
						</Label>
						<Input
							id={keywordInputId}
							maxLength={120}
							onChange={(e) => setKeyword(e.target.value)}
							placeholder="e.g. ShipBob, Shopify Plus, pet nutrition…"
							value={keyword}
						/>
						<p className="text-muted-foreground text-[11px]">
							Narrows Exa search results to a specific product sub-niche, 3PL,
							or stack.
						</p>
					</div>

					<fieldset className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<legend className="text-foreground text-xs font-semibold">
								4. Batch Size
							</legend>
							<span className="text-muted-foreground font-mono text-[11px]">
								Hard-capped at 10 per run
							</span>
						</div>
						<div className="grid grid-cols-3 gap-2">
							{BATCH_SIZE_OPTIONS.map((size) => {
								const isSelected = limit === size;
								return (
									<button
										aria-pressed={isSelected}
										className={cn(
											"rounded-lg border px-3 py-2 font-mono text-xs font-semibold transition-all",
											isSelected
												? "border-primary bg-primary/10 text-foreground ring-primary/25 ring-1"
												: "border-border/70 bg-card text-muted-foreground hover:text-foreground"
										)}
										key={size}
										onClick={() => setLimit(size)}
										type="button"
									>
										{size} leads
									</button>
								);
							})}
						</div>
					</fieldset>

					<DialogFooter className="pt-1">
						<Button
							disabled={isSubmitting}
							onClick={() => onOpenChange(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={isSubmitting}
							size="sm"
							type="submit"
							variant="primary"
						>
							{isSubmitting ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									<span>Starting Discovery…</span>
								</>
							) : (
								<>
									<Rocket className="h-3.5 w-3.5" />
									<span>Discover {limit} Leads</span>
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

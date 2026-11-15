"use client";

import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { useId } from "react";
import { EditableStringList } from "./editable-string-list";
import type { PlaybookDraft } from "./playbook-types";

interface SuppressionRow {
	companyId: string | null;
	createdAt: string;
	email: string;
	id: string;
	reason: string;
}

interface IcpSuppressionsPanelProps {
	draft: PlaybookDraft;
	onUpdate: (patch: Partial<PlaybookDraft>) => void;
	suppressionCount: number;
	suppressions: SuppressionRow[];
}

function formatUsdCompact(amount: number): string {
	if (!Number.isFinite(amount) || amount <= 0) {
		return "$0";
	}
	if (amount >= 1_000_000) {
		return `$${(amount / 1_000_000).toFixed(1)}M`;
	}
	if (amount >= 1000) {
		return `$${Math.round(amount / 1000)}K`;
	}
	return `$${amount}`;
}

export function IcpSuppressionsPanel({
	draft,
	onUpdate,
	suppressionCount,
	suppressions,
}: IcpSuppressionsPanelProps) {
	const geographyId = useId();
	const revMinId = useId();
	const revMaxId = useId();
	const empMinId = useId();
	const empMaxId = useId();

	return (
		<div className="space-y-6">
			{/* ICP Qualification Rubric Bounds */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Firmographic bounds, target channels, buyer personas, and buying signals used during prospect research."
					title="Ideal Customer Profile (ICP) Targeting"
				/>
				<SettingsSectionContent className="space-y-7">
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
							<Label htmlFor={geographyId}>Target Geography</Label>
							<Input
								className="h-10 text-sm"
								id={geographyId}
								onChange={(e) => onUpdate({ geography: e.target.value })}
								placeholder="United States"
								type="text"
								value={draft.geography}
							/>
						</div>

						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label htmlFor={revMinId}>Min Revenue (USD)</Label>
								<span className="text-muted-foreground font-mono text-[11px]">
									{formatUsdCompact(draft.revenueMinUsd)}
								</span>
							</div>
							<Input
								className="h-10 font-mono text-xs md:text-xs"
								id={revMinId}
								max={100_000_000}
								min={0}
								onChange={(e) => {
									const next = Number.parseInt(e.target.value, 10);
									onUpdate({
										revenueMinUsd: Number.isNaN(next) ? 0 : next,
									});
								}}
								step={100_000}
								type="number"
								value={draft.revenueMinUsd}
							/>
						</div>

						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label htmlFor={revMaxId}>Max Revenue (USD)</Label>
								<span className="text-muted-foreground font-mono text-[11px]">
									{formatUsdCompact(draft.revenueMaxUsd)}
								</span>
							</div>
							<Input
								className="h-10 font-mono text-xs md:text-xs"
								id={revMaxId}
								max={1_000_000_000}
								min={100_000}
								onChange={(e) => {
									const next = Number.parseInt(e.target.value, 10);
									onUpdate({
										revenueMaxUsd: Number.isNaN(next) ? 100_000 : next,
									});
								}}
								step={500_000}
								type="number"
								value={draft.revenueMaxUsd}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor={empMinId}>Min Employees</Label>
							<Input
								className="h-10 font-mono text-xs md:text-xs"
								id={empMinId}
								max={1000}
								min={1}
								onChange={(e) => {
									const next = Number.parseInt(e.target.value, 10);
									onUpdate({
										employeeMin: Number.isNaN(next) ? 1 : next,
									});
								}}
								type="number"
								value={draft.employeeMin}
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor={empMaxId}>Max Employees</Label>
							<Input
								className="h-10 font-mono text-xs md:text-xs"
								id={empMaxId}
								max={5000}
								min={1}
								onChange={(e) => {
									const next = Number.parseInt(e.target.value, 10);
									onUpdate({
										employeeMax: Number.isNaN(next) ? 1 : next,
									});
								}}
								type="number"
								value={draft.employeeMax}
							/>
						</div>
					</div>

					<div className="border-border/60 border-t pt-6">
						<EditableStringList
							addLabel="Add Channel"
							description="Sales storefronts and marketplaces used to qualify physical e-commerce brands."
							idPrefix="chan"
							items={draft.targetChannels}
							label="Target Sales Channels"
							maxItems={10}
							minItems={1}
							onChange={(targetChannels) => onUpdate({ targetChannels })}
							placeholder="e.g. Shopify"
						/>
					</div>

					<div className="border-border/60 border-t pt-6">
						<EditableStringList
							addLabel="Add Persona"
							description="Primary decision-makers prioritized during contact discovery."
							idPrefix="pers"
							items={draft.targetPersonas}
							label="Target Decision-Maker Personas"
							maxItems={10}
							minItems={1}
							onChange={(targetPersonas) => onUpdate({ targetPersonas })}
							placeholder="e.g. Founder / Co-Founder"
						/>
					</div>

					<div className="border-border/60 border-t pt-6">
						<EditableStringList
							addLabel="Add Timing Signal"
							description="Verified triggers that elevate prospect score and personalize first-touch outreach."
							idPrefix="sig"
							items={draft.timingSignals}
							label="Buying & Timing Signals"
							maxItems={10}
							minItems={1}
							onChange={(timingSignals) => onUpdate({ timingSignals })}
							placeholder="e.g. Hiring for finance, accounting, or operations roles"
						/>
					</div>
				</SettingsSectionContent>
			</SettingsSection>

			{/* Read-only Suppression & Opt-Out Gate */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Addresses that matched an opt-out/unsubscribe signal. Checked inside the worker send gate before every outbound email."
					title={`Hard Opt-Out & Suppression Gate (${suppressionCount})`}
				/>
				<SettingsSectionContent>
					{suppressions.length === 0 ? (
						<div className="border-border/60 bg-muted/20 text-muted-foreground rounded-xl border border-dashed p-5 text-xs">
							No suppressed addresses recorded yet. Any prospect replying with
							opt-out or &ldquo;not interested&rdquo; is added here permanently.
						</div>
					) : (
						<div className="divide-border/60 border-border/70 divide-y rounded-xl border">
							{suppressions.map((item) => (
								<div
									className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center"
									key={item.id}
								>
									<div className="min-w-0 space-y-0.5">
										<div className="text-foreground truncate font-mono text-xs font-medium">
											{item.email}
										</div>
										<div className="text-muted-foreground text-xs">
											Reason: {item.reason}
										</div>
									</div>
									<span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
										{new Date(item.createdAt).toLocaleDateString()}
									</span>
								</div>
							))}
						</div>
					)}
				</SettingsSectionContent>
			</SettingsSection>
		</div>
	);
}

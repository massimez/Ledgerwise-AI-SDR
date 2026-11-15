"use client";

import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { Lock } from "lucide-react";
import { useId } from "react";
import { EditableStringList } from "./editable-string-list";
import type { PlaybookDraft } from "./playbook-types";

interface PositioningRulesPanelProps {
	draft: PlaybookDraft;
	onUpdate: (patch: Partial<PlaybookDraft>) => void;
}

export function PositioningRulesPanel({
	draft,
	onUpdate,
}: PositioningRulesPanelProps) {
	const companyDescId = useId();
	const icpSummaryId = useId();
	const ctaId = useId();
	const pricingPolicyId = useId();

	return (
		<div className="space-y-6">
			{/* Core Positioning & CTA */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Core value proposition, target buyer framing, and closing call-to-action available to the AI drafter."
					title="Positioning & Call-to-Action"
				/>
				<SettingsSectionContent className="space-y-5">
					<div className="grid gap-5 lg:grid-cols-2">
						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label htmlFor={companyDescId}>Ledgerwise Positioning</Label>
								<span className="text-muted-foreground font-mono text-[11px] tabular-nums">
									{draft.companyDescription.length}/1000
								</span>
							</div>
							<textarea
								className="border-input bg-background/60 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-[104px] w-full resize-y rounded-lg border p-3 text-xs leading-relaxed shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
								id={companyDescId}
								onChange={(e) =>
									onUpdate({ companyDescription: e.target.value })
								}
								rows={4}
								value={draft.companyDescription}
							/>
						</div>

						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label htmlFor={icpSummaryId}>Ideal Customer Summary</Label>
								<span className="text-muted-foreground font-mono text-[11px] tabular-nums">
									{draft.idealCustomerSummary.length}/1000
								</span>
							</div>
							<textarea
								className="border-input bg-background/60 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-[104px] w-full resize-y rounded-lg border p-3 text-xs leading-relaxed shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
								id={icpSummaryId}
								onChange={(e) =>
									onUpdate({ idealCustomerSummary: e.target.value })
								}
								rows={4}
								value={draft.idealCustomerSummary}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor={ctaId}>Default Outbound Call-to-Action</Label>
							<span className="text-muted-foreground font-mono text-[11px] tabular-nums">
								{draft.callToAction.length}/400
							</span>
						</div>
						<textarea
							className="border-input bg-background/60 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border p-3 text-xs leading-relaxed shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
							id={ctaId}
							onChange={(e) => onUpdate({ callToAction: e.target.value })}
							rows={2}
							value={draft.callToAction}
						/>
						<p className="text-muted-foreground text-xs">
							Used as the closing question in first-touch outbound drafts.
						</p>
					</div>

					{/* Hard Pricing Policy Callout */}
					<div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.06] p-4">
						<div className="mb-2 flex items-center gap-2">
							<Lock className="h-4 w-4 text-amber-500" />
							<Label
								className="text-foreground text-sm font-semibold"
								htmlFor={pricingPolicyId}
							>
								Hard Pricing Policy (Never Quote Numbers in Email)
							</Label>
						</div>
						<textarea
							className="bg-background/80 text-foreground placeholder:text-muted-foreground w-full resize-y rounded-lg border border-amber-500/30 p-3 text-xs leading-relaxed shadow-xs outline-none focus-visible:border-amber-500 focus-visible:ring-[3px] focus-visible:ring-amber-500/25"
							id={pricingPolicyId}
							onChange={(e) => onUpdate({ pricingPolicy: e.target.value })}
							rows={3}
							value={draft.pricingPolicy}
						/>
						<p className="text-muted-foreground mt-2 text-xs">
							Outbound messages are checked deterministically for dollar amounts
							and monthly retainers before queuing; pricing questions deflect to
							a 15-minute call.
						</p>
					</div>
				</SettingsSectionContent>
			</SettingsSection>

			{/* Structured Services, Differentiators & Forbidden Topics */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Structured claims and hard boundaries used to ground first-touch emails and inbound replies."
					title="Services, Differentiators & Hard Boundaries"
				/>
				<SettingsSectionContent className="space-y-8">
					<EditableStringList
						addLabel="Add Service"
						description="Specific accounting and reconciliation workflows the AI SDR is approved to offer."
						idPrefix="svc"
						items={draft.services}
						label="Approved Bookkeeping Services"
						maxItems={12}
						minItems={1}
						onChange={(services) => onUpdate({ services })}
						placeholder="e.g. Monthly accrual bookkeeping closed by the 10th business day"
					/>

					<div className="border-border/60 border-t pt-6">
						<EditableStringList
							addLabel="Add Differentiator"
							description="Concrete distinctions vs. generalist CPAs or horizontal bookkeeping tools."
							idPrefix="diff"
							items={draft.differentiators}
							label="Key Differentiators vs Generic Bookkeepers"
							maxItems={12}
							minItems={1}
							onChange={(differentiators) => onUpdate({ differentiators })}
							placeholder="e.g. Dedicated US ecommerce accounting pod instead of generalist bookkeepers"
						/>
					</div>

					<div className="border-border/60 border-t pt-6">
						<EditableStringList
							addLabel="Add Forbidden Rule"
							description="Explicit non-negotiable topics or claims the AI SDR must never include."
							idPrefix="forbid"
							items={draft.forbiddenTopics}
							label="Forbidden Topics & Hard Stops"
							maxItems={15}
							minItems={0}
							onChange={(forbiddenTopics) => onUpdate({ forbiddenTopics })}
							placeholder="e.g. Never quote dollar prices, monthly retainers, or fee ranges"
							tone="rose"
						/>
					</div>
				</SettingsSectionContent>
			</SettingsSection>
		</div>
	);
}

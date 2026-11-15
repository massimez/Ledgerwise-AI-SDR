"use client";

import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { cn } from "@workspace/ui/lib/utils";
import { Gauge, ShieldAlert } from "lucide-react";
import { useId } from "react";
import type { PlaybookDraft } from "./playbook-types";

interface GuardrailsIdentityPanelProps {
	draft: PlaybookDraft;
	onUpdate: (patch: Partial<PlaybookDraft>) => void;
}

const AUTOPILOT_OPTIONS = [
	{
		badgeTone: "emerald" as const,
		desc: "Hold first emails for review; auto-send replies (>= 0.75 confidence) passing all guards.",
		label: "Replies Auto",
		value: "replies_auto" as const,
	},
	{
		badgeTone: "sky" as const,
		desc: "Hold every first email and reply draft in Review Queue for human sign-off.",
		label: "Manual Approval Only",
		value: "off" as const,
	},
	{
		badgeTone: "amber" as const,
		desc: "Auto-send qualified Tier A first emails and replies passing all deterministic guards.",
		label: "Full Autopilot",
		value: "full" as const,
	},
];

const DISCLOSURE_OPTIONS = [
	{
		desc: "Disclose AI identity only when a prospect asks.",
		label: "When Asked (Default)",
		value: "when_asked" as const,
	},
	{
		desc: "Append AI assistant disclosure to every reply.",
		label: "Always Disclose",
		value: "always" as const,
	},
];

const CAP_PRESETS = [25, 50, 100, 200] as const;

export function GuardrailsIdentityPanel({
	draft,
	onUpdate,
}: GuardrailsIdentityPanelProps) {
	const dailyCapId = useId();
	const senderNameId = useId();
	const senderTitleId = useId();
	const signatureId = useId();

	const signatureLines = draft.signature.trim()
		? draft.signature.trim().split("\n").length
		: 0;

	return (
		<div className="space-y-6">
			{/* Autopilot & Daily Volume Cap */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Choose when the AI SDR can queue sends automatically versus holding drafts for human sign-off."
					title="Autopilot & Human Approval Policy"
				/>
				<SettingsSectionContent className="space-y-3.5">
					<fieldset className="min-w-0 space-y-1.5">
						<legend className="sr-only">Autopilot approval mode</legend>
						{AUTOPILOT_OPTIONS.map((option) => {
							const selected = draft.autopilot === option.value;
							return (
								<label
									className={cn(
										"has-[:focus-visible]:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 has-[:focus-visible]:ring-2",
										selected &&
											option.badgeTone === "emerald" &&
											"border-emerald-500/60 bg-emerald-500/[0.07] shadow-xs",
										selected &&
											option.badgeTone === "sky" &&
											"border-sky-500/60 bg-sky-500/[0.07] shadow-xs",
										selected &&
											option.badgeTone === "amber" &&
											"border-amber-500/60 bg-amber-500/[0.07] shadow-xs",
										!selected &&
											"border-border/70 bg-background/40 hover:border-border hover:bg-muted/30"
									)}
									key={option.value}
								>
									<input
										checked={selected}
										className="sr-only"
										name="autopilot-mode"
										onChange={() => onUpdate({ autopilot: option.value })}
										type="radio"
										value={option.value}
									/>
									<span
										aria-hidden="true"
										className={cn(
											"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
											selected &&
												option.badgeTone === "emerald" &&
												"border-emerald-500 bg-emerald-500/20",
											selected &&
												option.badgeTone === "sky" &&
												"border-sky-500 bg-sky-500/20",
											selected &&
												option.badgeTone === "amber" &&
												"border-amber-500 bg-amber-500/20",
											!selected && "border-muted-foreground/40 bg-transparent"
										)}
									>
										{selected ? (
											<span
												className={cn(
													"h-1.5 w-1.5 rounded-full",
													option.badgeTone === "emerald" && "bg-emerald-500",
													option.badgeTone === "sky" && "bg-sky-500",
													option.badgeTone === "amber" && "bg-amber-500"
												)}
											/>
										) : null}
									</span>

									<div className="min-w-0 flex-1 space-y-0.5">
										<div className="text-foreground text-[13px] leading-tight font-semibold">
											{option.label}
										</div>
										<p className="text-muted-foreground max-w-2xl text-xs leading-snug">
											{option.desc}
										</p>
									</div>
								</label>
							);
						})}
					</fieldset>

					{/* Daily Send Cap */}
					<div className="border-border/60 bg-muted/20 flex flex-col justify-between gap-3 rounded-lg border px-3.5 py-3 sm:flex-row sm:items-center">
						<div className="min-w-0 space-y-0.5">
							<div className="flex items-center gap-2">
								<Gauge className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
								<Label
									className="text-foreground text-xs font-medium sm:text-sm"
									htmlFor={dailyCapId}
								>
									Daily Outbound Send Cap
								</Label>
							</div>
							<p className="text-muted-foreground text-xs leading-snug">
								Max worker outbound sends per day (1–500).
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
							<div className="flex items-center gap-1">
								{CAP_PRESETS.map((preset) => (
									<button
										className={cn(
											"cursor-pointer rounded-md border px-2 py-1 font-mono text-xs transition-colors",
											draft.dailySendCap === preset
												? "border-sky-500/60 bg-sky-500/15 text-sky-700 dark:text-sky-300"
												: "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground"
										)}
										key={preset}
										onClick={() => onUpdate({ dailySendCap: preset })}
										type="button"
									>
										{preset}
									</button>
								))}
							</div>
							<Input
								className="h-8 w-20 text-right font-mono text-xs md:text-xs"
								id={dailyCapId}
								max={500}
								min={1}
								onChange={(e) => {
									const next = Number.parseInt(e.target.value, 10);
									onUpdate({
										dailySendCap: Number.isNaN(next) ? 1 : next,
									});
								}}
								type="number"
								value={draft.dailySendCap}
							/>
						</div>
					</div>
				</SettingsSectionContent>
			</SettingsSection>

			{/* AI Bot Disclosure & Sender Identity */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Configure how the assistant identifies itself and the plain-text sender block appended to outbound emails."
					title="AI Bot Disclosure & Sender Identity"
				/>
				<SettingsSectionContent className="space-y-4">
					<fieldset className="grid min-w-0 gap-2 sm:grid-cols-2">
						<legend className="sr-only">AI bot disclosure policy</legend>
						{DISCLOSURE_OPTIONS.map((opt) => {
							const selected = draft.aiDisclosure === opt.value;
							return (
								<label
									className={cn(
										"has-[:focus-visible]:ring-ring flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 has-[:focus-visible]:ring-2",
										selected
											? "border-sky-500/60 bg-sky-500/[0.07] shadow-xs"
											: "border-border/70 bg-background/40 hover:border-border hover:bg-muted/30"
									)}
									key={opt.value}
								>
									<input
										checked={selected}
										className="sr-only"
										name="ai-disclosure-mode"
										onChange={() => onUpdate({ aiDisclosure: opt.value })}
										type="radio"
										value={opt.value}
									/>
									<span
										aria-hidden="true"
										className={cn(
											"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
											selected
												? "border-sky-500 bg-sky-500/20"
												: "border-muted-foreground/40 bg-transparent"
										)}
									>
										{selected ? (
											<span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
										) : null}
									</span>
									<div className="min-w-0 space-y-0.5">
										<div className="text-foreground text-[13px] leading-tight font-semibold">
											{opt.label}
										</div>
										<p className="text-muted-foreground text-[11px] leading-snug">
											{opt.desc}
										</p>
									</div>
								</label>
							);
						})}
					</fieldset>

					<div className="grid gap-3.5 sm:grid-cols-2">
						<div className="space-y-1">
							<Label className="text-xs" htmlFor={senderNameId}>
								Sender Name
							</Label>
							<Input
								className="h-9 text-xs md:text-xs"
								id={senderNameId}
								onChange={(e) => onUpdate({ senderName: e.target.value })}
								placeholder="Dana Mercer"
								type="text"
								value={draft.senderName}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs" htmlFor={senderTitleId}>
								Sender Title
							</Label>
							<Input
								className="h-9 text-xs md:text-xs"
								id={senderTitleId}
								onChange={(e) => onUpdate({ senderTitle: e.target.value })}
								placeholder="Head of Partnerships, Ledgerwise"
								type="text"
								value={draft.senderTitle}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<Label className="text-xs" htmlFor={signatureId}>
								Plain-Text Email Signature
							</Label>
							<span className="text-muted-foreground font-mono text-[11px] tabular-nums">
								{signatureLines} lines · {draft.signature.length}/600
							</span>
						</div>
						<textarea
							className="border-input bg-background/60 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-[88px] w-full resize-y rounded-lg border px-3.5 py-2.5 font-mono text-xs leading-relaxed shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
							id={signatureId}
							onChange={(e) => onUpdate({ signature: e.target.value })}
							rows={3}
							value={draft.signature}
						/>
						<p className="text-muted-foreground flex items-center gap-1.5 text-xs">
							<ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
							<span>
								Keep plain text only — no links or physical mailing address
								footer.
							</span>
						</p>
					</div>
				</SettingsSectionContent>
			</SettingsSection>
		</div>
	);
}

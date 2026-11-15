"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { FlaskConical, Loader2, Sparkles } from "lucide-react";
import { useId, useState } from "react";

const SIMULATOR_PRESETS = [
	{
		bodyText:
			"Sounds relevant! Quick question — are you an AI bot? Also, how much do you charge per month for a Shopify + Amazon brand?",
		description:
			"Tests honest bot disclosure (when_asked) + strict zero-pricing guard + Cal.com slot offer.",
		label: "Pricing + 'Are you a bot?'",
		preset: "pricing" as const,
	},
	{
		bodyText:
			"We're actually struggling with our 3PL inventory and Shopify payout reconciliation right now. What times do you have open next week?",
		description:
			"Tests high-confidence interest classification and timezone-aware Cal.com slot proposal.",
		label: "Interested · Ask Times",
		preset: "meeting_request" as const,
	},
	{
		bodyText:
			"2:00 PM works great for me — let's lock that time in on the calendar.",
		description:
			"Tests slot confirmation, automatic meeting booking, and transition to Booked state.",
		label: "Confirm Slot (Books Call)",
		preset: "slot_pick" as const,
	},
	{
		bodyText:
			"Can your team file international VAT registration in Germany and handle GAAP certified audit opinions?",
		description:
			"Tests out-of-playbook question detection → pauses AI and escalates thread to Needs You.",
		label: "Out-of-Playbook (Escalates)",
		preset: "outside_playbook" as const,
	},
	{
		bodyText:
			"We're all set internally — please unsubscribe me and remove me from your list.",
		description:
			"Tests hard opt-out regex → adds email to suppressions table and permanently locks thread.",
		label: "Opt-Out",
		preset: "opt_out" as const,
	},
] as const;

interface SimulateReplyDialogProps {
	companyName?: string | null;
	contactEmail?: string | null;
	contactName?: string | null;
	isSubmitting: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (bodyText: string) => Promise<void>;
	open: boolean;
}

export function SimulateReplyDialog({
	companyName,
	contactEmail,
	contactName,
	isSubmitting,
	onOpenChange,
	onSubmit,
	open,
}: SimulateReplyDialogProps) {
	const textareaId = useId();
	const [simulatorText, setSimulatorText] = useState<string>(
		SIMULATOR_PRESETS[0].bodyText
	);

	const activePreset = SIMULATOR_PRESETS.find(
		(preset) => preset.bodyText === simulatorText
	);
	const displayContact = contactName ?? "Prospect";
	const displayContext = contactEmail ?? companyName ?? "this thread";

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = simulatorText.trim();
		if (!trimmed) {
			return;
		}
		try {
			await onSubmit(trimmed);
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
						<FlaskConical className="text-primary h-4 w-4" />
						<span>Simulate Prospect Reply ({displayContact})</span>
					</DialogTitle>
					<DialogDescription className="text-xs leading-relaxed">
						Inject a simulated inbound email from{" "}
						<span className="text-foreground font-medium">
							{displayContext}
						</span>{" "}
						to test AI classification, safety guards, and call scheduling.
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4 py-1" onSubmit={handleSubmit}>
					<fieldset className="space-y-2">
						<legend className="text-foreground text-xs font-semibold">
							Scenario Presets
						</legend>
						<div className="flex flex-wrap gap-1.5">
							{SIMULATOR_PRESETS.map((preset) => {
								const isSelected = simulatorText === preset.bodyText;
								return (
									<button
										aria-pressed={isSelected}
										className={cn(
											"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
											isSelected
												? "border-primary bg-primary text-primary-foreground"
												: "border-border bg-card text-foreground hover:bg-muted"
										)}
										key={preset.label}
										onClick={() => setSimulatorText(preset.bodyText)}
										title={preset.description}
										type="button"
									>
										{preset.label}
									</button>
								);
							})}
						</div>
						{activePreset ? (
							<p className="text-muted-foreground text-[11px] leading-snug">
								{activePreset.description}
							</p>
						) : null}
					</fieldset>

					<div className="space-y-1.5">
						<Label className="text-xs font-semibold" htmlFor={textareaId}>
							Prospect Reply Message
						</Label>
						<textarea
							className="border-border bg-background text-foreground focus:border-primary w-full rounded-lg border p-2.5 text-xs leading-relaxed focus:outline-none"
							id={textareaId}
							onChange={(e) => setSimulatorText(e.target.value)}
							placeholder="Type a simulated reply from the prospect…"
							rows={4}
							value={simulatorText}
						/>
					</div>

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
							disabled={isSubmitting || !simulatorText.trim()}
							size="sm"
							type="submit"
							variant="primary"
						>
							{isSubmitting ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									<span>Simulating…</span>
								</>
							) : (
								<>
									<Sparkles className="h-3.5 w-3.5" />
									<span>Send Simulated Reply</span>
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

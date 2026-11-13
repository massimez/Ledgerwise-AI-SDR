"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
	Bot,
	Check,
	Plus,
	RotateCcw,
	Save,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	SdrAiDisclosureMode,
	SdrAutopilotMode,
	SdrPlaybookConfig,
} from "@/lib/sdr-fallback-data";
import { useSdrSettings } from "@/lib/sdr-hooks";

export default function PlaybookSettingsPage() {
	const {
		data,
		isLoading,
		saveSettings,
		resetDemoData,
		isSavingSettings,
		isResettingDemo,
	} = useSdrSettings();

	const [senderName, setSenderName] = useState("Dana Mercer");
	const [senderTitle, setSenderTitle] = useState(
		"Head of Partnerships, Ledgerwise"
	);
	const [signature, setSignature] = useState(
		"Best,\nDana Mercer\nHead of Partnerships, Ledgerwise"
	);
	const [autopilot, setAutopilot] = useState<SdrAutopilotMode>("replies_auto");
	const [aiDisclosure, setAiDisclosure] =
		useState<SdrAiDisclosureMode>("when_asked");
	const [playbook, setPlaybook] = useState<SdrPlaybookConfig | null>(null);
	const [savedBanner, setSavedBanner] = useState(false);

	useEffect(() => {
		if (data?.settings) {
			setSenderName(data.settings.senderName);
			setSenderTitle(data.settings.senderTitle);
			setSignature(data.settings.signature);
			setAutopilot(data.settings.autopilot);
			setAiDisclosure(data.settings.aiDisclosure);
			setPlaybook(data.settings.playbook as SdrPlaybookConfig);
		}
	}, [data?.settings]);

	const handleSave = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!playbook) {
			return;
		}
		await saveSettings({
			aiDisclosure,
			autopilot,
			playbook,
			senderName,
			senderTitle,
			signature,
		});
		setSavedBanner(true);
		setTimeout(() => setSavedBanner(false), 3000);
	};

	const handleResetDemo = async () => {
		await resetDemoData();
		setSavedBanner(true);
		setTimeout(() => setSavedBanner(false), 3000);
	};

	if (isLoading || !playbook) {
		return (
			<div className="border-border/70 bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
				Loading Ledgerwise SDR playbook…
			</div>
		);
	}

	return (
		<form className="space-y-6" onSubmit={handleSave}>
			{/* Header & Reset Demo Action */}
			<div className="border-border/70 bg-card flex flex-col justify-between gap-4 rounded-xl border p-6 sm:flex-row sm:items-center">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<h2 className="text-foreground text-lg font-bold">
							Ledgerwise Sales Playbook & AI Guardrails
						</h2>
						<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
							<ShieldCheck className="h-3.5 w-3.5" />
							<span>Active</span>
						</span>
					</div>
					<p className="text-muted-foreground text-xs">
						Non-technical sales configuration — controls what the AI SDR can
						claim, how it handles objections, and when it escalates to a human.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Button
						disabled={isResettingDemo}
						onClick={() => void handleResetDemo()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						<span>
							{isResettingDemo ? "Resetting…" : "Reset Sample Demo Data"}
						</span>
					</Button>

					<Button
						disabled={isSavingSettings}
						size="sm"
						type="submit"
						variant="primary"
					>
						<Save className="h-3.5 w-3.5" />
						<span>{isSavingSettings ? "Saving…" : "Save Playbook"}</span>
					</Button>
				</div>
			</div>

			{savedBanner ? (
				<div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
					<Check className="h-4 w-4" />
					<span>Playbook and SDR settings updated.</span>
				</div>
			) : null}

			{/* Autopilot & Disclosure Controls */}
			<div className="grid gap-6 md:grid-cols-2">
				<div className="border-border/70 bg-card space-y-3 rounded-xl border p-5">
					<div className="flex items-center gap-2">
						<Bot className="text-primary h-4 w-4" />
						<h3 className="text-foreground text-sm font-semibold">
							Autopilot & Human Approval Policy
						</h3>
					</div>
					<div className="space-y-2">
						{(
							[
								{
									desc: "First emails always require human review; high-confidence (>= 0.75) replies passing all guards auto-send.",
									label: "Replies Auto (Recommended)",
									value: "replies_auto",
								},
								{
									desc: "Every first email and every reply draft is held in the Review Queue for human approval.",
									label: "Manual Approval Only (Off)",
									value: "off",
								},
								{
									desc: "Auto-send replies and qualified Tier A drafts that pass all deterministic guards.",
									label: "Full Autopilot",
									value: "full",
								},
							] as const
						).map((option) => (
							<button
								className={cn(
									"w-full rounded-lg border p-3 text-left text-xs transition-colors",
									autopilot === option.value
										? "border-primary bg-primary/10"
										: "border-border/70 bg-background/50 hover:bg-background"
								)}
								key={option.value}
								onClick={() => setAutopilot(option.value)}
								type="button"
							>
								<div className="text-foreground font-semibold">
									{option.label}
								</div>
								<p className="text-muted-foreground mt-0.5">{option.desc}</p>
							</button>
						))}
					</div>
				</div>

				<div className="border-border/70 bg-card space-y-3 rounded-xl border p-5">
					<div className="flex items-center gap-2">
						<ShieldCheck className="text-primary h-4 w-4" />
						<h3 className="text-foreground text-sm font-semibold">
							AI Bot Disclosure & Sender Identity
						</h3>
					</div>

					<div className="grid grid-cols-2 gap-2">
						{(
							[
								{
									desc: "Disclose honestly whenever a prospect asks if they are speaking with a bot/AI.",
									label: "When Asked (Default)",
									value: "when_asked",
								},
								{
									desc: "Include AI assistant disclosure on every outbound reply.",
									label: "Always Disclose",
									value: "always",
								},
							] as const
						).map((opt) => (
							<button
								className={cn(
									"rounded-lg border p-2.5 text-left text-xs transition-colors",
									aiDisclosure === opt.value
										? "border-primary bg-primary/10"
										: "border-border/70 bg-background/50"
								)}
								key={opt.value}
								onClick={() => setAiDisclosure(opt.value)}
								type="button"
							>
								<div className="text-foreground font-semibold">{opt.label}</div>
								<p className="text-muted-foreground mt-0.5 text-[11px]">
									{opt.desc}
								</p>
							</button>
						))}
					</div>

					<div className="grid gap-3 pt-2 sm:grid-cols-2">
						<div className="space-y-1">
							<label
								className="text-foreground block text-xs font-medium"
								htmlFor="sender-name-input"
							>
								Sender Name
							</label>
							<input
								className="border-border bg-background text-foreground w-full rounded-md border px-2.5 py-1.5 text-xs"
								id="sender-name-input"
								onChange={(e) => setSenderName(e.target.value)}
								type="text"
								value={senderName}
							/>
						</div>
						<div className="space-y-1">
							<label
								className="text-foreground block text-xs font-medium"
								htmlFor="sender-title-input"
							>
								Sender Title
							</label>
							<input
								className="border-border bg-background text-foreground w-full rounded-md border px-2.5 py-1.5 text-xs"
								id="sender-title-input"
								onChange={(e) => setSenderTitle(e.target.value)}
								type="text"
								value={senderTitle}
							/>
						</div>
						<div className="space-y-1 sm:col-span-2">
							<label
								className="text-foreground block text-xs font-medium"
								htmlFor="signature-input"
							>
								Plain-Text Email Signature (No Physical Address Footer)
							</label>
							<textarea
								className="border-border bg-background text-foreground w-full rounded-md border px-2.5 py-1.5 font-mono text-xs"
								id="signature-input"
								onChange={(e) => setSignature(e.target.value)}
								rows={2}
								value={signature}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Value Proposition & Hard Pricing Rule */}
			<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5">
				<h3 className="text-foreground text-sm font-semibold">
					Company Description & Hard Pricing Policy
				</h3>

				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-1.5">
						<label
							className="text-foreground block text-xs font-medium"
							htmlFor="company-desc-textarea"
						>
							Ledgerwise Positioning
						</label>
						<textarea
							className="border-border bg-background text-foreground w-full rounded-lg border p-2.5 text-xs"
							id="company-desc-textarea"
							onChange={(e) =>
								setPlaybook({
									...playbook,
									companyDescription: e.target.value,
								})
							}
							rows={3}
							value={playbook.companyDescription}
						/>
					</div>

					<div className="space-y-1.5">
						<label
							className="text-foreground block text-xs font-medium"
							htmlFor="pricing-policy-textarea"
						>
							Hard Pricing Policy (Never Quote Numbers in Email)
						</label>
						<textarea
							className="border-border bg-background text-foreground w-full rounded-lg border p-2.5 text-xs"
							id="pricing-policy-textarea"
							onChange={(e) =>
								setPlaybook({ ...playbook, pricingPolicy: e.target.value })
							}
							rows={3}
							value={playbook.pricingPolicy}
						/>
					</div>
				</div>

				{/* Services & Differentiators */}
				<div className="grid gap-4 pt-2 md:grid-cols-2">
					<div className="space-y-1.5">
						<label
							className="text-foreground block text-xs font-medium"
							htmlFor="services-textarea"
						>
							Approved Bookkeeping Services (one per line)
						</label>
						<textarea
							className="border-border bg-background text-foreground w-full rounded-lg border p-2.5 text-xs"
							id="services-textarea"
							onChange={(e) =>
								setPlaybook({
									...playbook,
									services: e.target.value
										.split("\n")
										.map((s) => s.trim())
										.filter(Boolean),
								})
							}
							rows={5}
							value={playbook.services.join("\n")}
						/>
					</div>

					<div className="space-y-1.5">
						<label
							className="text-foreground block text-xs font-medium"
							htmlFor="differentiators-textarea"
						>
							Key Differentiators vs Generic Bookkeepers (one per line)
						</label>
						<textarea
							className="border-border bg-background text-foreground w-full rounded-lg border p-2.5 text-xs"
							id="differentiators-textarea"
							onChange={(e) =>
								setPlaybook({
									...playbook,
									differentiators: e.target.value
										.split("\n")
										.map((s) => s.trim())
										.filter(Boolean),
								})
							}
							rows={5}
							value={playbook.differentiators.join("\n")}
						/>
					</div>
				</div>
			</div>

			{/* FAQ Knowledge Base */}
			<div className="border-border/70 bg-card space-y-3 rounded-xl border p-5">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-foreground text-sm font-semibold">
							Approved Prospect FAQ Knowledge Base ({playbook.faq.length})
						</h3>
						<p className="text-muted-foreground text-xs">
							Questions outside this knowledge base automatically escalate the
							thread to <code className="font-mono">Needs You</code>.
						</p>
					</div>
					<Button
						onClick={() =>
							setPlaybook({
								...playbook,
								faq: [
									...playbook.faq,
									{
										answer: "We walk through that live on a discovery call.",
										question: `New prospect question #${playbook.faq.length + 1}?`,
									},
								],
							})
						}
						size="sm"
						type="button"
						variant="outline"
					>
						<Plus className="h-3.5 w-3.5" />
						<span>Add FAQ</span>
					</Button>
				</div>

				<div className="space-y-3">
					{playbook.faq.map((entry) => (
						<div
							className="border-border/70 bg-background/50 space-y-2 rounded-lg border p-3.5"
							key={entry.question}
						>
							<div className="flex items-center justify-between gap-2">
								<input
									aria-label={`FAQ question: ${entry.question}`}
									className="border-border bg-background text-foreground w-full rounded border px-2.5 py-1 text-xs font-semibold"
									onChange={(e) => {
										const next = playbook.faq.map((item) =>
											item.question === entry.question
												? { ...item, question: e.target.value }
												: item
										);
										setPlaybook({ ...playbook, faq: next });
									}}
									type="text"
									value={entry.question}
								/>
								<button
									aria-label="Remove FAQ item"
									className="text-muted-foreground rounded p-1 hover:bg-rose-500/10 hover:text-rose-500"
									onClick={() =>
										setPlaybook({
											...playbook,
											faq: playbook.faq.filter(
												(item) => item.question !== entry.question
											),
										})
									}
									type="button"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
							<textarea
								aria-label={`FAQ answer for ${entry.question}`}
								className="border-border bg-background text-muted-foreground w-full rounded border p-2 text-xs"
								onChange={(e) => {
									const next = playbook.faq.map((item) =>
										item.question === entry.question
											? { ...item, answer: e.target.value }
											: item
									);
									setPlaybook({ ...playbook, faq: next });
								}}
								rows={2}
								value={entry.answer}
							/>
						</div>
					))}
				</div>
			</div>
		</form>
	);
}

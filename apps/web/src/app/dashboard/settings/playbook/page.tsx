"use client";

import { Button } from "@workspace/ui/components/button";
import { SettingsPage } from "@workspace/ui/components/settings-shell";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import {
	AlertCircle,
	BookOpen,
	Compass,
	type LucideIcon,
	MessageSquareText,
	RotateCcw,
	Save,
	SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSdrSettings } from "@/lib/sdr-hooks";
import { FaqObjectionsPanel } from "./_components/faq-objections-panel";
import { GuardrailsIdentityPanel } from "./_components/guardrails-identity-panel";
import { IcpSuppressionsPanel } from "./_components/icp-suppressions-panel";
import {
	draftToPayload,
	type PlaybookDraft,
	serializePayload,
	settingsToDraft,
	validatePayload,
} from "./_components/playbook-types";
import { PositioningRulesPanel } from "./_components/positioning-rules-panel";

type PlaybookTabId = "guardrails" | "positioning" | "knowledge" | "icp";

const AUTOPILOT_SHORT_LABELS = {
	full: "Full Autopilot",
	off: "Manual Only",
	replies_auto: "Replies Auto",
} as const;

export default function PlaybookSettingsPage() {
	const {
		data,
		error: settingsError,
		isError,
		isLoading,
		refetch,
		saveSettings,
		resetDemoData,
		isSavingSettings,
		isResettingDemo,
	} = useSdrSettings();

	const [activeTab, setActiveTab] = useState<PlaybookTabId>("guardrails");
	const [draft, setDraft] = useState<PlaybookDraft | null>(null);
	const [baselineSerialized, setBaselineSerialized] = useState<string>("");
	const [validationError, setValidationError] = useState<string | null>(null);
	const syncedServerSnapshotRef = useRef<string | null>(null);

	const currentPayload = useMemo(
		() => (draft ? draftToPayload(draft) : null),
		[draft]
	);

	const isDirty = useMemo(() => {
		if (!(currentPayload && baselineSerialized)) {
			return false;
		}
		return serializePayload(currentPayload) !== baselineSerialized;
	}, [currentPayload, baselineSerialized]);

	useEffect(() => {
		if (!data?.settings) {
			return;
		}
		const nextDraft = settingsToDraft(data.settings);
		const nextSerialized = serializePayload(draftToPayload(nextDraft));
		if (
			syncedServerSnapshotRef.current === null ||
			(!isDirty && syncedServerSnapshotRef.current !== nextSerialized)
		) {
			syncedServerSnapshotRef.current = nextSerialized;
			setDraft(nextDraft);
			setBaselineSerialized(nextSerialized);
			setValidationError(null);
		}
	}, [data?.settings, isDirty]);

	const updateDraft = (patch: Partial<PlaybookDraft>) => {
		setValidationError(null);
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
	};

	const handleDiscard = () => {
		if (!data?.settings) {
			return;
		}
		const resetDraft = settingsToDraft(data.settings);
		const nextSerialized = serializePayload(draftToPayload(resetDraft));
		syncedServerSnapshotRef.current = nextSerialized;
		setDraft(resetDraft);
		setBaselineSerialized(nextSerialized);
		setValidationError(null);
	};

	const handleSave = async (event?: React.FormEvent) => {
		event?.preventDefault();
		if (!(draft && currentPayload)) {
			return;
		}

		const error = validatePayload(currentPayload);
		if (error) {
			setValidationError(error);
			toast.error(error);
			return;
		}

		setValidationError(null);
		try {
			await saveSettings(currentPayload);
			const savedSerialized = serializePayload(currentPayload);
			syncedServerSnapshotRef.current = savedSerialized;
			setBaselineSerialized(savedSerialized);
		} catch {
			// Surfaced via mutation onError toast
		}
	};

	const handleResetDemo = async () => {
		setValidationError(null);
		syncedServerSnapshotRef.current = null;
		try {
			await resetDemoData();
		} catch {
			// Surfaced via mutation onError toast
		}
	};

	if (isError && !draft) {
		return (
			<SettingsPage
				description="Controls what the AI SDR can claim, how it handles objections, and when it escalates to a human."
				headingLevel="h2"
				title="Ledgerwise Sales Playbook & AI Guardrails"
			>
				<div className="border-border/70 bg-card space-y-3 rounded-2xl border p-8 text-center text-sm">
					<p className="text-rose-600 dark:text-rose-400">
						{settingsError instanceof Error
							? settingsError.message
							: "Failed to load Ledgerwise SDR playbook."}
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
			</SettingsPage>
		);
	}

	if (isLoading || !draft) {
		return (
			<SettingsPage
				description="Controls what the AI SDR can claim, how it handles objections, and when it escalates to a human."
				headingLevel="h2"
				title="Ledgerwise Sales Playbook & AI Guardrails"
			>
				<div className="border-border/70 bg-card/70 text-muted-foreground rounded-2xl border p-10 text-center text-sm">
					Loading Ledgerwise SDR playbook…
				</div>
			</SettingsPage>
		);
	}

	const suppressionCount = data?.suppressionCount ?? 0;
	const suppressions = data?.suppressions ?? [];

	const navItems: Array<{
		badge: string;
		icon: LucideIcon;
		id: PlaybookTabId;
		label: string;
	}> = [
		{
			badge: AUTOPILOT_SHORT_LABELS[draft.autopilot],
			icon: SlidersHorizontal,
			id: "guardrails",
			label: "Guardrails & Identity",
		},
		{
			badge: `${draft.services.length + draft.differentiators.length} rules`,
			icon: BookOpen,
			id: "positioning",
			label: "Positioning & Rules",
		},
		{
			badge: `${draft.faq.length + draft.objectionHandling.length}`,
			icon: MessageSquareText,
			id: "knowledge",
			label: "FAQ & Objections",
		},
		{
			badge: suppressionCount > 0 ? `${suppressionCount} opt-out` : "ICP",
			icon: Compass,
			id: "icp",
			label: "ICP & Suppressions",
		},
	];

	return (
		<form onSubmit={(e) => void handleSave(e)}>
			<SettingsPage
				action={
					<>
						<Button
							disabled={isResettingDemo || isSavingSettings}
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
							disabled={isSavingSettings || !isDirty}
							size="sm"
							type="submit"
							variant="primary"
						>
							<Save className="h-3.5 w-3.5" />
							<span>{isSavingSettings ? "Saving…" : "Save Playbook"}</span>
						</Button>
					</>
				}
				description="Non-technical sales configuration — controls what the AI SDR can claim, how it handles objections, and when it escalates to a human."
				headingLevel="h2"
				title="Ledgerwise Sales Playbook & AI Guardrails"
			>
				{validationError ? (
					<div
						className="flex items-center gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300"
						role="alert"
					>
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{validationError}</span>
					</div>
				) : null}

				<Tabs
					className="block w-full"
					onValueChange={(value) => setActiveTab(value as PlaybookTabId)}
					orientation="vertical"
					value={activeTab}
				>
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-[276px_minmax(0,1fr)] lg:items-start">
						{/* Left-side Navigation & Guardrail Snapshot */}
						<aside className="min-w-0 space-y-4 lg:sticky lg:top-28 lg:self-start">
							<TabsList
								aria-label="Playbook sections"
								className="border-border/60 bg-card/70 flex h-auto w-full items-stretch justify-start gap-1 overflow-x-auto rounded-2xl border p-1.5 backdrop-blur-xs lg:flex-col"
							>
								{navItems.map((item) => {
									const Icon = item.icon;
									const isActive = activeTab === item.id;
									return (
										<TabsTrigger
											className={cn(
												"flex shrink-0 cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-left text-xs font-medium transition-all lg:w-full",
												"data-[state=active]:border-border/70 data-[state=active]:bg-muted/80 data-[state=active]:text-foreground data-[state=active]:shadow-xs",
												"text-muted-foreground hover:text-foreground hover:bg-muted/40"
											)}
											key={item.id}
											value={item.id}
										>
											<span className="flex min-w-0 items-center gap-2.5">
												<Icon
													aria-hidden="true"
													className={cn(
														"h-4 w-4 shrink-0 transition-colors",
														isActive
															? "text-emerald-600 dark:text-emerald-400"
															: "text-muted-foreground"
													)}
												/>
												<span className="truncate">{item.label}</span>
											</span>
											<span
												className={cn(
													"hidden shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums xl:inline-flex",
													isActive
														? "bg-background/80 text-foreground border-border/60 border"
														: "bg-muted/60 text-muted-foreground"
												)}
											>
												{item.badge}
											</span>
										</TabsTrigger>
									);
								})}
							</TabsList>

							{/* Compact Guardrail Snapshot */}
							<div className="border-border/60 bg-card/60 hidden rounded-2xl border p-4 backdrop-blur-xs lg:block">
								<div className="text-foreground mb-3 text-xs font-semibold">
									Guardrail Snapshot
								</div>
								<dl className="space-y-2.5 text-xs">
									<div className="flex items-center justify-between gap-2">
										<dt className="text-muted-foreground">Mode</dt>
										<dd className="text-foreground font-medium">
											{AUTOPILOT_SHORT_LABELS[draft.autopilot]}
										</dd>
									</div>
									<div className="flex items-center justify-between gap-2">
										<dt className="text-muted-foreground">Daily Cap</dt>
										<dd className="text-foreground font-mono tabular-nums">
											{draft.dailySendCap}/day
										</dd>
									</div>
									<div className="flex items-center justify-between gap-2">
										<dt className="text-muted-foreground">Disclosure</dt>
										<dd className="text-foreground font-medium">
											{draft.aiDisclosure === "always"
												? "Always"
												: "When asked"}
										</dd>
									</div>
									<div className="flex items-center justify-between gap-2">
										<dt className="text-muted-foreground">Pricing Lock</dt>
										<dd className="font-medium text-amber-600 dark:text-amber-400">
											Never quote $
										</dd>
									</div>
									<div className="border-border/50 flex items-center justify-between gap-2 border-t pt-2.5">
										<dt className="text-muted-foreground">Suppressed</dt>
										<dd className="text-foreground font-mono tabular-nums">
											{suppressionCount}
										</dd>
									</div>
								</dl>
							</div>
						</aside>

						{/* Right-hand Active Panel */}
						<div className="min-w-0">
							<TabsContent className="mt-0" value="guardrails">
								<GuardrailsIdentityPanel draft={draft} onUpdate={updateDraft} />
							</TabsContent>

							<TabsContent className="mt-0" value="positioning">
								<PositioningRulesPanel draft={draft} onUpdate={updateDraft} />
							</TabsContent>

							<TabsContent className="mt-0" value="knowledge">
								<FaqObjectionsPanel draft={draft} onUpdate={updateDraft} />
							</TabsContent>

							<TabsContent className="mt-0" value="icp">
								<IcpSuppressionsPanel
									draft={draft}
									onUpdate={updateDraft}
									suppressionCount={suppressionCount}
									suppressions={suppressions}
								/>
							</TabsContent>
						</div>
					</div>
				</Tabs>

				{/* Sticky Unsaved Changes Bar */}
				{isDirty ? (
					<div className="border-border/80 bg-card/95 sticky bottom-4 z-20 flex flex-col justify-between gap-3 rounded-2xl border px-5 py-3.5 shadow-lg backdrop-blur-md sm:flex-row sm:items-center">
						<div className="flex items-center gap-2.5 text-xs">
							<span className="h-2 w-2 rounded-full bg-amber-500" />
							<span className="text-foreground font-medium">
								You have unsaved playbook changes.
							</span>
						</div>
						<div className="flex items-center gap-2">
							<Button
								disabled={isSavingSettings}
								onClick={handleDiscard}
								size="sm"
								type="button"
								variant="ghost"
							>
								Discard
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
				) : null}
			</SettingsPage>
		</form>
	);
}

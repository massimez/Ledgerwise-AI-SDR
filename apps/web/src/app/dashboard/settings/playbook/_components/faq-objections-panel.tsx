"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { MessageSquareWarning, Plus, Trash2 } from "lucide-react";
import { createStableKey, type PlaybookDraft } from "./playbook-types";

interface FaqObjectionsPanelProps {
	draft: PlaybookDraft;
	onUpdate: (patch: Partial<PlaybookDraft>) => void;
}

export function FaqObjectionsPanel({
	draft,
	onUpdate,
}: FaqObjectionsPanelProps) {
	const handleAddFaq = () => {
		if (draft.faq.length >= 20) {
			return;
		}
		onUpdate({
			faq: [
				...draft.faq,
				{
					answer: "",
					id: createStableKey("faq"),
					question: "",
				},
			],
		});
	};

	const handleAddObjection = () => {
		if (draft.objectionHandling.length >= 20) {
			return;
		}
		onUpdate({
			objectionHandling: [
				...draft.objectionHandling,
				{
					id: createStableKey("obj"),
					objection: "",
					responseGuidance: "",
				},
			],
		});
	};

	return (
		<div className="space-y-6">
			{/* Approved FAQ Knowledge Base */}
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button
							disabled={draft.faq.length >= 20}
							onClick={handleAddFaq}
							size="sm"
							type="button"
							variant="outline"
						>
							<Plus className="h-3.5 w-3.5" />
							<span>Add FAQ</span>
						</Button>
					}
					description="Questions outside this approved knowledge base escalate the thread to Needs You and pause AI auto-replies."
					title={`Approved Prospect FAQ Knowledge Base (${draft.faq.length}/20)`}
				/>
				<SettingsSectionContent className="space-y-3.5">
					{draft.faq.length === 0 ? (
						<div className="border-border/60 bg-muted/20 text-muted-foreground rounded-xl border border-dashed p-6 text-center text-xs">
							No FAQ entries configured. Prospect questions will escalate to
							human review.
						</div>
					) : (
						draft.faq.map((entry, idx) => (
							<div
								className="border-border/70 bg-background/50 space-y-3 rounded-xl border p-4"
								key={entry.id}
							>
								<div className="flex items-center justify-between gap-2">
									<div className="flex min-w-0 flex-1 items-center gap-2.5">
										<span className="text-muted-foreground w-6 shrink-0 font-mono text-xs font-medium tabular-nums">
											Q{idx + 1}
										</span>
										<Input
											aria-label={`FAQ question ${idx + 1}`}
											className="h-9 flex-1 text-xs font-semibold md:text-xs"
											onChange={(e) => {
												const next = draft.faq.map((item) =>
													item.id === entry.id
														? { ...item, question: e.target.value }
														: item
												);
												onUpdate({ faq: next });
											}}
											placeholder="e.g. How do you reconcile Shopify and Amazon Seller Central?"
											type="text"
											value={entry.question}
										/>
									</div>
									<Button
										aria-label={`Remove FAQ item ${idx + 1}`}
										className="text-muted-foreground h-9 w-9 shrink-0 hover:bg-rose-500/10 hover:text-rose-500"
										onClick={() =>
											onUpdate({
												faq: draft.faq.filter((item) => item.id !== entry.id),
											})
										}
										size="icon"
										type="button"
										variant="ghost"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
								<div className="space-y-1 pl-0 sm:pl-9">
									<Label
										className="text-muted-foreground text-[11px]"
										htmlFor={`faq-answer-${entry.id}`}
									>
										Approved Answer
									</Label>
									<textarea
										className="border-input bg-background/80 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border p-2.5 text-xs leading-relaxed outline-none focus-visible:ring-[3px]"
										id={`faq-answer-${entry.id}`}
										onChange={(e) => {
											const next = draft.faq.map((item) =>
												item.id === entry.id
													? { ...item, answer: e.target.value }
													: item
											);
											onUpdate({ faq: next });
										}}
										placeholder="Approved plain-text response grounded in Ledgerwise capabilities…"
										rows={3}
										value={entry.answer}
									/>
								</div>
							</div>
						))
					)}
				</SettingsSectionContent>
			</SettingsSection>

			{/* Objection Handling Playbook */}
			<SettingsSection>
				<SettingsSectionHeader
					action={
						<Button
							disabled={draft.objectionHandling.length >= 20}
							onClick={handleAddObjection}
							size="sm"
							type="button"
							variant="outline"
						>
							<Plus className="h-3.5 w-3.5" />
							<span>Add Objection</span>
						</Button>
					}
					description="Guided talking points when prospects cite an existing CPA, tool, or internal team."
					title={`Objection Handling Playbook (${draft.objectionHandling.length}/20)`}
				/>
				<SettingsSectionContent className="space-y-3.5">
					{draft.objectionHandling.length === 0 ? (
						<div className="border-border/60 bg-muted/20 text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center text-xs">
							<MessageSquareWarning className="h-4 w-4 opacity-70" />
							<span>
								No objection handlers configured yet. Add one to guide AI
								replies.
							</span>
						</div>
					) : (
						draft.objectionHandling.map((entry, idx) => (
							<div
								className="border-border/70 bg-background/50 space-y-3 rounded-xl border p-4"
								key={entry.id}
							>
								<div className="flex items-center justify-between gap-2">
									<div className="flex min-w-0 flex-1 items-center gap-2.5">
										<span className="w-6 shrink-0 font-mono text-xs font-medium text-amber-600 tabular-nums dark:text-amber-400">
											O{idx + 1}
										</span>
										<Input
											aria-label={`Prospect objection ${idx + 1}`}
											className="h-9 flex-1 text-xs font-semibold md:text-xs"
											onChange={(e) => {
												const next = draft.objectionHandling.map((item) =>
													item.id === entry.id
														? { ...item, objection: e.target.value }
														: item
												);
												onUpdate({ objectionHandling: next });
											}}
											placeholder="e.g. We already have a local CPA or bookkeeper"
											type="text"
											value={entry.objection}
										/>
									</div>
									<Button
										aria-label={`Remove objection item ${idx + 1}`}
										className="text-muted-foreground h-9 w-9 shrink-0 hover:bg-rose-500/10 hover:text-rose-500"
										onClick={() =>
											onUpdate({
												objectionHandling: draft.objectionHandling.filter(
													(item) => item.id !== entry.id
												),
											})
										}
										size="icon"
										type="button"
										variant="ghost"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
								<div className="space-y-1 pl-0 sm:pl-9">
									<Label
										className="text-muted-foreground text-[11px]"
										htmlFor={`obj-guidance-${entry.id}`}
									>
										Response Guidance
									</Label>
									<textarea
										className="border-input bg-background/80 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border p-2.5 text-xs leading-relaxed outline-none focus-visible:ring-[3px]"
										id={`obj-guidance-${entry.id}`}
										onChange={(e) => {
											const next = draft.objectionHandling.map((item) =>
												item.id === entry.id
													? { ...item, responseGuidance: e.target.value }
													: item
											);
											onUpdate({ objectionHandling: next });
										}}
										placeholder="How the AI SDR should acknowledge and differentiate…"
										rows={3}
										value={entry.responseGuidance}
									/>
								</div>
							</div>
						))
					)}
				</SettingsSectionContent>
			</SettingsSection>
		</div>
	);
}

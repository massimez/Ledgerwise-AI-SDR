"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { createStableKey, type KeyedStringItem } from "./playbook-types";

interface EditableStringListProps {
	addLabel: string;
	description?: string;
	idPrefix: string;
	items: KeyedStringItem[];
	label: string;
	maxItems: number;
	minItems: number;
	onChange: (next: KeyedStringItem[]) => void;
	placeholder: string;
	tone?: "default" | "rose";
}

export function EditableStringList({
	addLabel,
	description,
	idPrefix,
	items,
	label,
	maxItems,
	minItems,
	onChange,
	placeholder,
	tone = "default",
}: EditableStringListProps) {
	const canAdd = items.length < maxItems;
	const canRemove = items.length > minItems;

	const handleAdd = () => {
		if (!canAdd) {
			return;
		}
		onChange([...items, { id: createStableKey(idPrefix), value: "" }]);
	};

	const handleUpdate = (id: string, value: string) => {
		onChange(items.map((item) => (item.id === id ? { ...item, value } : item)));
	};

	const handleRemove = (id: string) => {
		if (!canRemove) {
			return;
		}
		onChange(items.filter((item) => item.id !== id));
	};

	return (
		<fieldset className="min-w-0 space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="space-y-0.5">
					<legend className="text-foreground text-sm font-medium">
						{label}
					</legend>
					{description ? (
						<p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
							{description}
						</p>
					) : null}
				</div>
				<span className="text-muted-foreground bg-muted/60 border-border/60 rounded-md border px-2 py-0.5 font-mono text-[11px] tabular-nums">
					{items.length}/{maxItems}
				</span>
			</div>

			{items.length === 0 ? (
				<div className="border-border/60 bg-muted/20 text-muted-foreground rounded-xl border border-dashed px-4 py-4 text-xs">
					No entries added yet.
				</div>
			) : (
				<div className="space-y-2">
					{items.map((item, idx) => (
						<div className="flex items-center gap-2" key={item.id}>
							<span
								aria-hidden="true"
								className={cn(
									"flex h-9 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-medium tabular-nums",
									tone === "rose"
										? "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400"
										: "border-border/60 bg-muted/40 text-muted-foreground"
								)}
							>
								{idx + 1}
							</span>
							<Input
								aria-label={`${label} item ${idx + 1}`}
								className={cn(
									"h-9 flex-1 text-xs md:text-xs",
									tone === "rose" &&
										"focus-visible:border-rose-500/60 focus-visible:ring-rose-500/20"
								)}
								onChange={(e) => handleUpdate(item.id, e.target.value)}
								placeholder={placeholder}
								type="text"
								value={item.value}
							/>
							<Button
								aria-label={`Remove ${label} item ${idx + 1}`}
								className="text-muted-foreground h-9 w-9 shrink-0 hover:bg-rose-500/10 hover:text-rose-500"
								disabled={!canRemove}
								onClick={() => handleRemove(item.id)}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</div>
					))}
				</div>
			)}

			<div>
				<Button
					disabled={!canAdd}
					onClick={handleAdd}
					size="sm"
					type="button"
					variant="outline"
				>
					<Plus className="h-3.5 w-3.5" />
					<span>{addLabel}</span>
				</Button>
			</div>
		</fieldset>
	);
}

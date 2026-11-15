import { APP_CONFIG } from "@workspace/api/config";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

interface AppHeaderProps {
	actions?: ReactNode;
	brandHref?: string;
}

/** Shared top bar so landing and dashboard keep identical height and branding. */
export function AppHeader({ actions, brandHref = "/" }: AppHeaderProps) {
	return (
		<header className="border-border/70 bg-background/95 sticky top-0 z-40 w-full border-b backdrop-blur-xs">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6">
				<Link
					className="text-foreground flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight sm:gap-2.5"
					href={brandHref}
				>
					<BrandMark className="h-7 w-7" />
					<span className="truncate">{APP_CONFIG.name}</span>
				</Link>

				{actions ? (
					<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
						{actions}
					</div>
				) : null}
			</div>
		</header>
	);
}

"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
	BookOpen,
	Building2,
	CalendarCheck,
	CheckCircle2,
	Inbox,
	LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSdrDashboard } from "@/lib/sdr-hooks";

export function DashboardNav() {
	const pathname = usePathname();
	const { data: dashboardData } = useSdrDashboard();

	const pendingReviewCount = dashboardData?.kpis.pendingReviewCount ?? 0;
	const needsHumanCount = dashboardData?.kpis.needsHumanCount ?? 0;
	const bookedCallsCount = dashboardData?.kpis.bookedCount ?? 0;

	const navLinks = [
		{
			badge: null,
			badgeTone: "neutral" as const,
			exact: true,
			href: "/dashboard",
			icon: LayoutDashboard,
			label: "Today",
		},
		{
			badge: null,
			badgeTone: "neutral" as const,
			exact: false,
			href: "/dashboard/companies",
			icon: Building2,
			label: "Companies",
		},
		{
			badge: pendingReviewCount > 0 ? pendingReviewCount : null,
			badgeTone: "amber" as const,
			exact: false,
			href: "/dashboard/review",
			icon: CheckCircle2,
			label: "Review Queue",
		},
		{
			badge: needsHumanCount > 0 ? needsHumanCount : null,
			badgeTone: "rose" as const,
			exact: false,
			href: "/dashboard/inbox",
			icon: Inbox,
			label: "Inbox",
		},
		{
			badge: bookedCallsCount > 0 ? bookedCallsCount : null,
			badgeTone: "emerald" as const,
			exact: false,
			href: "/dashboard/meetings",
			icon: CalendarCheck,
			label: "Meetings",
		},
		{
			badge: null,
			badgeTone: "neutral" as const,
			exact: false,
			href: "/dashboard/settings/playbook",
			icon: BookOpen,
			label: "Playbook",
		},
	];

	return (
		<nav
			aria-label="Ledgerwise SDR navigation"
			className="border-border/70 bg-background/95 sticky top-16 z-30 w-full border-b backdrop-blur-xs"
		>
			<div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
				{navLinks.map((item) => {
					const Icon = item.icon;
					const isActive = item.exact
						? pathname === item.href
						: pathname.startsWith(item.href);

					return (
						<Link
							aria-current={isActive ? "page" : undefined}
							className={cn(
								"focus-visible:ring-ring inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
								isActive
									? "bg-primary/10 text-foreground ring-primary/20 font-semibold ring-1"
									: "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
							)}
							href={item.href}
							key={item.href}
						>
							<Icon
								aria-hidden="true"
								className={cn(
									"h-3.5 w-3.5 shrink-0",
									isActive ? "text-primary" : "text-muted-foreground"
								)}
							/>
							<span>{item.label}</span>
							{item.badge === null ? null : (
								<span
									className={cn(
										"inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums",
										item.badgeTone === "amber" &&
											"bg-amber-500/15 text-amber-700 dark:text-amber-300",
										item.badgeTone === "rose" &&
											"bg-rose-500/15 text-rose-700 dark:text-rose-300",
										item.badgeTone === "emerald" &&
											"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
									)}
								>
									{item.badge}
								</span>
							)}
						</Link>
					);
				})}
			</div>
		</nav>
	);
}

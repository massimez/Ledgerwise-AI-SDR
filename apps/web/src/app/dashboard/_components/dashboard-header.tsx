"use client";

import { NotificationCenter } from "@workspace/ui/components/notification-center";
import {
	type OrganizationItem,
	OrganizationSwitcher,
} from "@workspace/ui/components/organization-switcher";
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
import { usePathname, useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAccountMenu } from "@/components/user-account-menu";
import { publicWebEnv } from "@/env";
import {
	useCurrentOrganization,
	useOrganizationMutations,
} from "@/lib/organization-hooks";
import { useSdrDashboard } from "@/lib/sdr-hooks";

export function DashboardHeader() {
	const router = useRouter();
	const pathname = usePathname();
	const { activeOrgId, currentUserRole, organizations, session } =
		useCurrentOrganization();
	const { createOrganization, setActiveOrganization } =
		useOrganizationMutations({
			showToasts: false,
		});
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

	const orgItems: OrganizationItem[] = organizations.map((org) => ({
		id: org.id,
		logo: org.logo,
		name: org.name,
		slug: org.slug,
	}));

	const handleSelectOrg = async (orgId: string) => {
		await setActiveOrganization({ organizationId: orgId });
		router.refresh();
	};

	const handleCreateOrg = async (name: string, slug: string) => {
		await createOrganization({ name, slug });
		router.refresh();
	};

	return (
		<AppHeader
			actions={
				<>
					<ThemeToggle />
					<NotificationCenter
						apiUrl={publicWebEnv.apiUrl}
						onNavigate={(path) => router.push(path)}
					/>
					<OrganizationSwitcher
						activeOrgId={activeOrgId}
						onCreateOrg={handleCreateOrg}
						onSelectOrg={handleSelectOrg}
						organizations={orgItems}
					/>
					<UserAccountMenu
						redirectAfterSignOut="/"
						role={currentUserRole}
						user={session?.user}
					/>
				</>
			}
			brandHref="/dashboard"
			nav={
				<nav
					aria-label="Ledgerwise SDR navigation"
					className="hidden items-center gap-1 lg:flex"
				>
					{navLinks.map((item) => {
						const Icon = item.icon;
						const isActive = item.exact
							? pathname === item.href
							: pathname.startsWith(item.href);

						return (
							<Link
								className={cn(
									"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
									isActive
										? "bg-primary/10 text-foreground font-semibold"
										: "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
								)}
								href={item.href}
								key={item.href}
							>
								<Icon
									className={cn(
										"h-3.5 w-3.5",
										isActive ? "text-primary" : "text-muted-foreground"
									)}
								/>
								<span>{item.label}</span>
								{item.badge === null ? null : (
									<span
										className={cn(
											"py-0.2 inline-flex min-w-4 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
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
				</nav>
			}
		/>
	);
}

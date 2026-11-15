import { APP_CONFIG } from "@workspace/api/config";
import { Button } from "@workspace/ui/components/button";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getServerSession } from "@/lib/auth-server";

const HOME_TITLE = `${APP_CONFIG.name} — Outbound & Booking Workbench`;
const HOME_DESCRIPTION =
	"Evidence-grounded AI SDR for US e-commerce brands: verified prospect research, human-approved first outreach, strict zero-pricing replies, and Cal.com booking.";

export const metadata: Metadata = {
	alternates: {
		canonical: "/",
	},
	description: HOME_DESCRIPTION,
	title: {
		absolute: HOME_TITLE,
	},
};

const SAFETY_GUARDS = [
	"Zero unverified company facts — every claim links to fetched source text",
	"Zero pricing over email — regex and judge guards enforce call-only quoting",
	"Hard opt-out & permanent suppression gate checked before every outbound send",
	"Confidence < 0.75, legal/audit questions, and >= 3 auto-replies escalate to humans",
] as const;

export default async function HomePage() {
	const session = await getServerSession();
	const primaryHref = session?.user
		? "/dashboard"
		: "/?auth=signin&callbackUrl=/dashboard";

	return (
		<div className="bg-background text-foreground flex min-h-screen flex-col">
			<SiteHeader />

			<main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-12 px-4 py-12 sm:px-6 sm:py-16">
				<section className="space-y-6">
					<div className="max-w-3xl space-y-4">
						<h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-5xl">
							Ledgerwise AI SDR Console
						</h1>
						<p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
							Autonomous outbound prospecting and inbox triage built for
							Ledgerwise&apos;s outsourced US e-commerce bookkeeping team—with
							strict source verification, zero-pricing email guards, and Cal.com
							scheduling.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<Button asChild size="md" variant="primary">
							<Link href={primaryHref}>
								<span>
									{session?.user
										? "Open SDR Workspace"
										: "Sign In to SDR Console"}
								</span>
								<ArrowRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</section>

				<section className="border-border/70 space-y-3 rounded-xl border p-4">
					<ul className="grid gap-2 text-xs sm:grid-cols-2">
						{SAFETY_GUARDS.map((rule) => (
							<li
								className="text-muted-foreground flex items-start gap-2"
								key={rule}
							>
								<span>{rule}</span>
							</li>
						))}
					</ul>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}

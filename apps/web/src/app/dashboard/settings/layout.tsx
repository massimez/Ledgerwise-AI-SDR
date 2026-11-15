import type { ReactNode } from "react";
import { SettingsNav } from "./_components/settings-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 sm:space-y-7 sm:p-6 lg:p-10">
			<SettingsNav />

			<div className="w-full min-w-0">{children}</div>
		</div>
	);
}

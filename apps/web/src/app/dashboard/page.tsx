import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { SdrTodayClient } from "./_components/sdr-today-client";

export default async function DashboardPage() {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/?auth=signin&callbackUrl=/dashboard");
	}

	return <SdrTodayClient userName={session.user.name} />;
}

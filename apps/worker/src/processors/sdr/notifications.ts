import { db } from "@workspace/db";
import { member, notification } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logWarning } from "../../lib/logger";

/** Dispatch an in-app SDR notification to members of the organization. */
export async function notifyOrgSdrMembers(options: {
	content: string;
	data?: Record<string, unknown>;
	idempotencyKey?: string;
	organizationId: string;
	title: string;
	type: string;
}): Promise<void> {
	try {
		const orgMembers = await db
			.select({ userId: member.userId })
			.from(member)
			.where(eq(member.organizationId, options.organizationId))
			.limit(10);

		if (orgMembers.length === 0) {
			return;
		}

		await db.insert(notification).values(
			orgMembers.map((entry) => ({
				userId: entry.userId,
				organizationId: options.organizationId,
				category: "system" as const,
				type: options.type,
				title: options.title,
				content: options.content,
				data: options.data ?? null,
				idempotencyKey: options.idempotencyKey
					? `${options.idempotencyKey}:${entry.userId}`
					: null,
			}))
		);
	} catch (error) {
		logWarning("SdrNotifications", "Failed to create org SDR notification", {
			error: error instanceof Error ? error.message : "unknown",
			type: options.type,
		});
	}
}

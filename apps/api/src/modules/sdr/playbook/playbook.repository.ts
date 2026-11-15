import {
	DEFAULT_LEDGERWISE_ICP,
	DEFAULT_LEDGERWISE_PLAYBOOK,
	db,
} from "@workspace/db";
import {
	type SdrAiDisclosureMode,
	type SdrAutopilotMode,
	type SdrIcpConfig,
	type SdrPlaybookConfig,
	sdrSettings,
	suppressions,
} from "@workspace/db/schema";
import { seedLedgerwiseWorkspace } from "@workspace/db/seed";
import { count, desc, eq } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

export interface UpdateSdrSettingsInput {
	aiDisclosure?: SdrAiDisclosureMode;
	autopilot?: SdrAutopilotMode;
	dailySendCap?: number;
	icp?: SdrIcpConfig;
	playbook?: SdrPlaybookConfig;
	senderName?: string;
	senderTitle?: string;
	signature?: string;
}

/** Find existing SDR settings row for an organization. */
export async function findSettingsByOrg(organizationId: string) {
	const [row] = await db
		.select()
		.from(sdrSettings)
		.where(eq(sdrSettings.organizationId, organizationId))
		.limit(1);

	return row ?? null;
}

/** Insert default Ledgerwise SDR settings if absent, returning the row if inserted. */
export async function createDefaultSettings(organizationId: string) {
	const [created] = await db
		.insert(sdrSettings)
		.values({
			aiDisclosure: "when_asked",
			autopilot: "replies_auto",
			dailySendCap: 25,
			icp: DEFAULT_LEDGERWISE_ICP,
			organizationId,
			playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
			senderName: "Dana Mercer",
			senderTitle: "Head of Partnerships, Ledgerwise",
			signature: "Best,\nDana Mercer\nHead of Partnerships, Ledgerwise",
		})
		.onConflictDoNothing()
		.returning();

	return created ?? null;
}

/** Count total suppressed email addresses for an organization. */
export async function countSuppressionsByOrg(organizationId: string) {
	const [row] = await db
		.select({ value: count() })
		.from(suppressions)
		.where(withOrg(suppressions, organizationId));

	return row?.value ?? 0;
}

/** List recent suppressed email addresses for an organization. */
export async function listSuppressionsByOrg(
	organizationId: string,
	limit = 50
) {
	return await db
		.select()
		.from(suppressions)
		.where(withOrg(suppressions, organizationId))
		.orderBy(desc(suppressions.createdAt))
		.limit(limit);
}

/** Update SDR settings fields for an organization. */
export async function updateSettingsByOrg(
	organizationId: string,
	input: UpdateSdrSettingsInput
) {
	const [updated] = await db
		.update(sdrSettings)
		.set({
			...(input.aiDisclosure ? { aiDisclosure: input.aiDisclosure } : {}),
			...(input.autopilot ? { autopilot: input.autopilot } : {}),
			...(input.dailySendCap === undefined
				? {}
				: { dailySendCap: input.dailySendCap }),
			...(input.icp ? { icp: input.icp } : {}),
			...(input.playbook ? { playbook: input.playbook } : {}),
			...(input.senderName ? { senderName: input.senderName } : {}),
			...(input.senderTitle ? { senderTitle: input.senderTitle } : {}),
			...(input.signature ? { signature: input.signature } : {}),
		})
		.where(eq(sdrSettings.organizationId, organizationId))
		.returning();

	return updated ?? null;
}

/** Reset SDR demo tables and re-seed the default Ledgerwise workspace. */
export async function resetDemoWorkspace() {
	return await seedLedgerwiseWorkspace(db, { resetExistingSdrData: true });
}

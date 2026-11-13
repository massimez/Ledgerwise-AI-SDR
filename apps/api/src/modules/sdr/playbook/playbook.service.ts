import { NotFoundError } from "../../../lib/errors";
import {
	countSuppressionsByOrg,
	createDefaultSettings,
	findSettingsByOrg,
	listSuppressionsByOrg,
	resetDemoWorkspace,
	type UpdateSdrSettingsInput,
	updateSettingsByOrg,
} from "./playbook.repository";

/** Ensure an organization has an SDR settings record, seeding defaults on first access. */
export async function ensureSdrSettingsForOrg(organizationId: string) {
	const existing = await findSettingsByOrg(organizationId);
	if (existing) {
		return existing;
	}

	const created = await createDefaultSettings(organizationId);
	if (created) {
		return created;
	}

	const fallback = await findSettingsByOrg(organizationId);
	if (!fallback) {
		throw new NotFoundError("SDR settings");
	}
	return fallback;
}

/** Load SDR settings along with suppression count and recent suppressed contacts. */
export async function getSdrSettings(organizationId: string) {
	const settings = await ensureSdrSettingsForOrg(organizationId);
	const [suppressionCount, suppressionRows] = await Promise.all([
		countSuppressionsByOrg(organizationId),
		listSuppressionsByOrg(organizationId),
	]);

	return {
		settings,
		suppressionCount,
		suppressions: suppressionRows,
	};
}

/** Persist updates to an organization's SDR playbook, ICP, or autopilot settings. */
export async function updateSdrSettings(
	organizationId: string,
	input: UpdateSdrSettingsInput
) {
	await ensureSdrSettingsForOrg(organizationId);
	return await updateSettingsByOrg(organizationId, input);
}

/** Reset sandbox SDR data and re-seed the default Ledgerwise demo scenario. */
export async function resetDemoData() {
	return await resetDemoWorkspace();
}

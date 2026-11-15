"use client";

import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { useNotificationPreferences } from "@/lib/notification-hooks";
import { PreferenceMatrixContent } from "./_components/preference-matrix-content";

export default function NotificationSettingsPage() {
	const {
		error,
		isError,
		isLoading,
		pendingKey,
		preferences,
		togglePreference,
	} = useNotificationPreferences();

	return (
		<SettingsPage
			description="Choose which SDR workspace events (review drafts ready, escalations, and booked discovery calls) trigger alerts."
			headingLevel="h2"
			title="Notifications & Delivery"
		>
			<SettingsSection>
				<SettingsSectionHeader
					description="Fine-tune in-app and email delivery preferences per event category."
					title="Channel Preferences"
				/>
				<SettingsSectionContent>
					<PreferenceMatrixContent
						error={error}
						isError={isError}
						isLoading={isLoading}
						onToggle={togglePreference}
						pendingKey={pendingKey}
						preferences={preferences}
					/>
				</SettingsSectionContent>
			</SettingsSection>
		</SettingsPage>
	);
}

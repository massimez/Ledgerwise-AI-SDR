import { logInfo } from "../../../lib/logger";
import {
	findMeetingByCalBookingUid,
	markBookingConfirmed,
	updateMeetingFromWebhook,
} from "./calcom.repository";
import type { CalcomWebhookPayload } from "./calcom.schema";

/** Process validated Cal.com booking lifecycle webhooks cleanly. */
export async function processCalcomWebhookEvent(
	triggerEvent: string,
	payload: CalcomWebhookPayload
) {
	const { uid } = payload;
	if (!uid) {
		return { ignored: "missing_uid", received: true };
	}

	const existingMeeting = await findMeetingByCalBookingUid(uid);
	if (!existingMeeting) {
		return { received: true, unmatched: uid };
	}

	if (triggerEvent === "BOOKING_CANCELLED") {
		await updateMeetingFromWebhook(existingMeeting.id, {
			status: "cancelled",
		});
	} else if (triggerEvent === "BOOKING_RESCHEDULED") {
		await updateMeetingFromWebhook(existingMeeting.id, {
			...(payload.endTime ? { endAt: new Date(payload.endTime) } : {}),
			...(payload.meetingUrl ? { meetingUrl: payload.meetingUrl } : {}),
			...(payload.startTime ? { startAt: new Date(payload.startTime) } : {}),
			status: "rescheduled",
		});
	} else if (triggerEvent === "BOOKING_CREATED") {
		await updateMeetingFromWebhook(existingMeeting.id, {
			...(payload.meetingUrl ? { meetingUrl: payload.meetingUrl } : {}),
			status: "scheduled",
		});
		await markBookingConfirmed({
			companyId: existingMeeting.companyId,
			organizationId: existingMeeting.organizationId,
			threadId: existingMeeting.threadId,
		});
	}

	logInfo("Webhooks:Calcom", "Processed Cal.com webhook event", {
		triggerEvent,
		uid,
	});

	return { received: true, triggerEvent, uid };
}

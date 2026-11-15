import { sanitizeExternalHttpUrl } from "@workspace/ai-core/contracts";
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

	const safeMeetingUrl = sanitizeExternalHttpUrl(payload.meetingUrl);

	if (triggerEvent === "BOOKING_CANCELLED") {
		await updateMeetingFromWebhook(existingMeeting.id, {
			status: "cancelled",
		});
	} else if (triggerEvent === "BOOKING_RESCHEDULED") {
		await updateMeetingFromWebhook(existingMeeting.id, {
			...(payload.endTime ? { endAt: new Date(payload.endTime) } : {}),
			...(safeMeetingUrl ? { meetingUrl: safeMeetingUrl } : {}),
			...(payload.startTime ? { startAt: new Date(payload.startTime) } : {}),
			status: "rescheduled",
		});
	} else if (triggerEvent === "BOOKING_CREATED") {
		await markBookingConfirmed({
			companyId: existingMeeting.companyId,
			meetingId: existingMeeting.id,
			meetingPatch: {
				...(safeMeetingUrl ? { meetingUrl: safeMeetingUrl } : {}),
				status: "scheduled",
			},
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

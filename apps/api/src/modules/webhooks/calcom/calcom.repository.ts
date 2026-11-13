import { db } from "@workspace/db";
import {
	companies,
	type MeetingStatus,
	meetings,
	threads,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

/** Find an existing SDR meeting row by Cal.com booking UID. */
export async function findMeetingByCalBookingUid(uid: string) {
	const [meeting] = await db
		.select()
		.from(meetings)
		.where(eq(meetings.calBookingUid, uid))
		.limit(1);

	return meeting ?? null;
}

/** Update meeting status and optional start/end/URL fields from Cal.com lifecycle events. */
export async function updateMeetingFromWebhook(
	meetingId: string,
	patch: {
		endAt?: Date;
		meetingUrl?: string;
		startAt?: Date;
		status: MeetingStatus;
	}
) {
	await db.update(meetings).set(patch).where(eq(meetings.id, meetingId));
}

/** Mark linked thread as booked (AI paused) and company as `meeting_booked`. */
export async function markBookingConfirmed(params: {
	companyId: string;
	organizationId: string;
	threadId: string | null;
}) {
	await Promise.all([
		params.threadId
			? db
					.update(threads)
					.set({ aiMode: "paused", status: "booked" })
					.where(
						and(
							eq(threads.id, params.threadId),
							eq(threads.organizationId, params.organizationId)
						)
					)
			: Promise.resolve(),
		db
			.update(companies)
			.set({ status: "meeting_booked" })
			.where(eq(companies.id, params.companyId)),
	]);
}

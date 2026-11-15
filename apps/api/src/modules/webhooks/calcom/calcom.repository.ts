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

/** Update meeting and transactionally mark linked thread + company booked. */
export async function markBookingConfirmed(params: {
	companyId: string;
	meetingId?: string;
	meetingPatch?: {
		endAt?: Date;
		meetingUrl?: string;
		startAt?: Date;
		status: MeetingStatus;
	};
	organizationId: string;
	threadId: string | null;
}) {
	await db.transaction(async (tx) => {
		if (params.meetingId && params.meetingPatch) {
			await tx
				.update(meetings)
				.set(params.meetingPatch)
				.where(
					and(
						eq(meetings.id, params.meetingId),
						eq(meetings.organizationId, params.organizationId)
					)
				);
		}
		if (params.threadId) {
			await tx
				.update(threads)
				.set({ aiMode: "paused", status: "booked" })
				.where(
					and(
						eq(threads.id, params.threadId),
						eq(threads.organizationId, params.organizationId)
					)
				);
		}
		await tx
			.update(companies)
			.set({ status: "meeting_booked" })
			.where(
				and(
					eq(companies.id, params.companyId),
					eq(companies.organizationId, params.organizationId)
				)
			);
	});
}

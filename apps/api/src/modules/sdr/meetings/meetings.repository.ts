import { db } from "@workspace/db";
import { companies, contacts, meetings } from "@workspace/db/schema";
import { asc, inArray } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Load scheduled meetings along with matched company and contact lookup rows for an organization. */
export async function listMeetingsWithContextByOrg(organizationId: string) {
	const meetingRows = await db
		.select()
		.from(meetings)
		.where(withOrg(meetings, organizationId))
		.orderBy(asc(meetings.startAt));

	if (meetingRows.length === 0) {
		return {
			companies: [],
			contacts: [],
			meetings: [],
		};
	}

	const companyIds = [
		...new Set(meetingRows.map((meeting) => meeting.companyId)),
	];
	const contactIds = [
		...new Set(
			meetingRows
				.map((meeting) => meeting.contactId)
				.filter((id): id is string => Boolean(id))
		),
	];

	const [matchedCompanies, matchedContacts] = await Promise.all([
		db
			.select()
			.from(companies)
			.where(
				withOrg(companies, organizationId, inArray(companies.id, companyIds))
			),
		contactIds.length > 0
			? db
					.select()
					.from(contacts)
					.where(
						withOrg(contacts, organizationId, inArray(contacts.id, contactIds))
					)
			: Promise.resolve([]),
	]);

	return {
		companies: matchedCompanies,
		contacts: matchedContacts,
		meetings: meetingRows,
	};
}

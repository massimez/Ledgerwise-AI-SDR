import { listMeetingsWithContextByOrg } from "./meetings.repository";

/** Return all meetings for an organization enriched with company and contact metadata. */
export async function listMeetings(organizationId: string) {
	const {
		meetings: rows,
		companies,
		contacts,
	} = await listMeetingsWithContextByOrg(organizationId);

	const companyMap = new Map(companies.map((c) => [c.id, c]));
	const contactMap = new Map(contacts.map((c) => [c.id, c]));

	return rows.map((meeting) => ({
		company: companyMap.get(meeting.companyId) ?? null,
		contact: meeting.contactId
			? (contactMap.get(meeting.contactId) ?? null)
			: null,
		meeting,
	}));
}

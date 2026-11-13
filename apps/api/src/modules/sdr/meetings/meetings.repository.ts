import { db } from "@workspace/db";
import { companies, contacts, meetings } from "@workspace/db/schema";
import { asc } from "drizzle-orm";
import { withOrg } from "../../../lib/tenant";

/** Load scheduled meetings along with company and contact lookup rows for an organization. */
export async function listMeetingsWithContextByOrg(organizationId: string) {
	const [meetingRows, orgCompanies, orgContacts] = await Promise.all([
		db
			.select()
			.from(meetings)
			.where(withOrg(meetings, organizationId))
			.orderBy(asc(meetings.startAt)),
		db.select().from(companies).where(withOrg(companies, organizationId)),
		db.select().from(contacts).where(withOrg(contacts, organizationId)),
	]);

	return {
		companies: orgCompanies,
		contacts: orgContacts,
		meetings: meetingRows,
	};
}

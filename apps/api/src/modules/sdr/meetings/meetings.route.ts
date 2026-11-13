import {
	createRouter,
	createSuccessResponse,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { listMeetings } from "./meetings.service";

export const meetingsRoutes = createRouter().get(
	"/",
	hasOrgPermission("meeting:read"),
	async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const items = await listMeetings(organizationId);
		return c.json(createSuccessResponse({ meetings: items }));
	}
);

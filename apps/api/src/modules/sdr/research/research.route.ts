import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { startResearchRunSchema } from "../schema";
import { listResearchRuns, startResearchRun } from "./research.service";

export const researchRoutes = createRouter()
	.get("/runs", hasOrgPermission("lead:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const runs = await listResearchRuns(organizationId);
		return c.json(createSuccessResponse({ runs }));
	})
	.post(
		"/runs",
		hasOrgPermission("lead:research"),
		jsonValidator(startResearchRunSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await startResearchRun({
				organizationId,
				queries: input.queries,
				targetCount: input.targetCount,
				userId,
			});
			return c.json(createSuccessResponse(result), 202);
		}
	);

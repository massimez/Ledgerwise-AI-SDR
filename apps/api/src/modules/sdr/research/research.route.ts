import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { rateLimiter } from "../../../middleware/rate-limiter";
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
		rateLimiter(60_000, 10, {
			identity: "actor",
			operation: "sdr:research",
		}),
		jsonValidator(startResearchRunSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await startResearchRun({
				keyword: input.keyword,
				limit: input.limit,
				niche: input.niche,
				organizationId,
				queries: input.queries,
				signalPreset: input.signalPreset,
				targetCount: input.targetCount,
				userId,
			});
			return c.json(createSuccessResponse(result), 202);
		}
	);

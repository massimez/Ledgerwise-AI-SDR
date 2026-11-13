import { createRouter, createSuccessResponse } from "../../lib/create-hono-app";
import { getActiveOrgContext } from "../../lib/tenant";
import { authMiddleware } from "../../middleware/auth";
import { hasOrgPermission } from "../../middleware/org-permission";
import { rateLimiter } from "../../middleware/rate-limiter";
import { tenantBoundaryMiddleware } from "../../middleware/tenant-boundary";
import { companiesRoutes } from "./companies/companies.route";
import { meetingsRoutes } from "./meetings/meetings.route";
import { playbookRoutes } from "./playbook/playbook.route";
import { researchRoutes } from "./research/research.route";
import { getDashboardSummary } from "./research/research.service";
import { reviewRoutes } from "./review/review.route";
import { threadsRoutes } from "./threads/threads.route";

export const sdrRoutes = createRouter()
	.use(
		"*",
		authMiddleware,
		tenantBoundaryMiddleware,
		rateLimiter(60_000, 180, { identity: "actor" })
	)
	.get("/dashboard", hasOrgPermission("lead:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const summary = await getDashboardSummary(organizationId);
		return c.json(createSuccessResponse(summary));
	})
	.route("/companies", companiesRoutes)
	.route("/review", reviewRoutes)
	.route("/threads", threadsRoutes)
	.route("/meetings", meetingsRoutes)
	.route("/settings", playbookRoutes)
	.route("/research", researchRoutes);

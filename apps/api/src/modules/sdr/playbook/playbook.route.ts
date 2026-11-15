import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { rateLimiter } from "../../../middleware/rate-limiter";
import { updateSdrSettingsSchema } from "../schema";
import {
	getSdrSettings,
	resetDemoData,
	updateSdrSettings,
} from "./playbook.service";

export const playbookRoutes = createRouter()
	.get("/", hasOrgPermission("playbook:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const result = await getSdrSettings(organizationId);
		return c.json(createSuccessResponse(result));
	})
	.put(
		"/",
		hasOrgPermission("playbook:update"),
		jsonValidator(updateSdrSettingsSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const updated = await updateSdrSettings(organizationId, input);
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/reset-demo",
		hasOrgPermission("playbook:update"),
		rateLimiter(60_000, 5, {
			identity: "actor",
			operation: "sdr:reset-demo",
		}),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const summary = await resetDemoData(organizationId);
			return c.json(createSuccessResponse(summary));
		}
	);

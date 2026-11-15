import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { rateLimiter } from "../../../middleware/rate-limiter";
import {
	approveMessageSchema,
	messageIdParamSchema,
	regenerateDraftSchema,
	rejectMessageSchema,
} from "../schema";
import {
	approveReviewMessage,
	getReviewQueue,
	regenerateReviewDraft,
	rejectReviewMessage,
} from "./review.service";

export const reviewRoutes = createRouter()
	.get("/", hasOrgPermission("outreach:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const items = await getReviewQueue(organizationId);
		return c.json(createSuccessResponse({ items }));
	})
	.post(
		"/:messageId/approve",
		hasOrgPermission("outreach:approve"),
		paramValidator(messageIdParamSchema),
		jsonValidator(approveMessageSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { messageId } = c.req.valid("param");
			const input = c.req.valid("json");
			const updated = await approveReviewMessage({
				bodyText: input.bodyText,
				messageId,
				organizationId,
				subject: input.subject,
				userId,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/:messageId/reject",
		hasOrgPermission("outreach:approve"),
		paramValidator(messageIdParamSchema),
		jsonValidator(rejectMessageSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { messageId } = c.req.valid("param");
			const { reason } = c.req.valid("json");
			const updated = await rejectReviewMessage({
				messageId,
				organizationId,
				reason,
				userId,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/:messageId/regenerate",
		hasOrgPermission("outreach:approve"),
		rateLimiter(60_000, 15, {
			identity: "actor",
			operation: "sdr:regenerate",
		}),
		paramValidator(messageIdParamSchema),
		jsonValidator(regenerateDraftSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { messageId } = c.req.valid("param");
			const { instruction } = c.req.valid("json");
			const result = await regenerateReviewDraft({
				instruction,
				messageId,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(result), 202);
		}
	);

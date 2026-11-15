import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import { rateLimiter } from "../../../middleware/rate-limiter";
import {
	listThreadsQuerySchema,
	sendHumanReplySchema,
	simulateInboundReplySchema,
	threadIdParamSchema,
} from "../schema";
import {
	getThreadDetail,
	listThreads,
	releaseThreadToAi,
	sendHumanReply,
	simulateInboundReply,
	takeoverThread,
} from "./threads.service";

export const threadsRoutes = createRouter()
	.get(
		"/",
		hasOrgPermission("conversation:read"),
		queryValidator(listThreadsQuerySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { status } = c.req.valid("query");
			const items = await listThreads(organizationId, status);
			return c.json(createSuccessResponse({ threads: items }));
		}
	)
	.get(
		"/:id",
		hasOrgPermission("conversation:read"),
		paramValidator(threadIdParamSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const detail = await getThreadDetail(organizationId, id);
			return c.json(createSuccessResponse(detail));
		}
	)
	.post(
		"/:id/takeover",
		hasOrgPermission("conversation:takeover"),
		paramValidator(threadIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const updated = await takeoverThread({
				organizationId,
				threadId: id,
				userId,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/:id/release",
		hasOrgPermission("conversation:takeover"),
		paramValidator(threadIdParamSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const updated = await releaseThreadToAi({
				organizationId,
				threadId: id,
			});
			return c.json(createSuccessResponse(updated));
		}
	)
	.post(
		"/:id/messages",
		hasOrgPermission("conversation:reply"),
		paramValidator(threadIdParamSchema),
		jsonValidator(sendHumanReplySchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const created = await sendHumanReply({
				bodyText: input.bodyText,
				organizationId,
				subject: input.subject,
				threadId: id,
				userId,
			});
			return c.json(createSuccessResponse(created), 201);
		}
	)
	.post(
		"/:id/simulate-inbound",
		hasOrgPermission("conversation:reply"),
		rateLimiter(60_000, 15, {
			identity: "actor",
			operation: "sdr:simulate-inbound",
		}),
		paramValidator(threadIdParamSchema),
		jsonValidator(simulateInboundReplySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const result = await simulateInboundReply({
				bodyText: input.bodyText,
				organizationId,
				threadId: id,
			});
			return c.json(createSuccessResponse(result), 202);
		}
	);

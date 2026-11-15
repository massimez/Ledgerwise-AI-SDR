import {
	DISCOVERY_NICHE_IDS,
	isPublicHttpUrl,
	sdrIcpSchema,
	sdrPlaybookSchema,
} from "@workspace/ai-core/contracts";
import {
	COMPANY_STATUSES,
	COMPANY_TIERS,
	SDR_AI_DISCLOSURE_MODES,
	SDR_AUTOPILOT_MODES,
	THREAD_STATUSES,
} from "@workspace/db/schema";
import { z } from "zod";
import { SDR_DISCOVERY_SIGNAL_PRESETS } from "../../lib/queues";

export const COMPANY_SORT_OPTIONS = [
	"score_desc",
	"score_asc",
	"recent",
	"oldest",
	"name_asc",
] as const;

export type CompanySortOption = (typeof COMPANY_SORT_OPTIONS)[number];

export const listCompaniesQuerySchema = z.object({
	includeHidden: z
		.enum(["true", "false"])
		.optional()
		.transform((val) => val === "true"),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
	q: z.string().trim().max(120).optional(),
	signal: z.string().trim().max(80).optional(),
	sort: z.enum(COMPANY_SORT_OPTIONS).default("score_desc"),
	status: z.enum(COMPANY_STATUSES).optional(),
	tier: z.enum(COMPANY_TIERS).optional(),
});

export const companyIdParamSchema = z.object({
	id: z.string().uuid(),
});

export const messageIdParamSchema = z.object({
	messageId: z.string().uuid(),
});

export const threadIdParamSchema = z.object({
	id: z.string().uuid(),
});

export const startResearchRunSchema = z
	.object({
		keyword: z.string().trim().max(120).optional(),
		limit: z.number().int().min(1).max(10).optional(),
		niche: z.enum(DISCOVERY_NICHE_IDS).optional(),
		queries: z.array(z.string().trim().min(3).max(200)).max(10).optional(),
		signalPreset: z.enum(SDR_DISCOVERY_SIGNAL_PRESETS).optional(),
		targetCount: z.number().int().min(1).max(60).optional(),
	})
	.refine(
		(data) =>
			!(
				data.signalPreset &&
				data.targetCount !== undefined &&
				data.targetCount > 10
			),
		{
			message: "Signal discovery batches are capped at 10 leads per run",
			path: ["targetCount"],
		}
	);

export const importCompanyUrlSchema = z.object({
	hqLocation: z.string().trim().max(120).optional(),
	name: z.string().trim().min(1).max(160).optional(),
	website: z
		.string()
		.trim()
		.url()
		.refine((url) => isPublicHttpUrl(url, { allowHttp: true }), {
			message: "Website must be a valid public http or https URL",
		}),
});

export const updateCompanySchema = z.object({
	disqualifyReason: z.string().trim().max(500).nullable().optional(),
	hidden: z.boolean().optional(),
	status: z.enum(COMPANY_STATUSES).optional(),
	tier: z.enum(COMPANY_TIERS).optional(),
});

export const approveMessageSchema = z.object({
	bodyText: z.string().trim().min(10).max(4000).optional(),
	subject: z.string().trim().min(3).max(255).optional(),
});

export const rejectMessageSchema = z.object({
	reason: z.string().trim().min(2).max(500),
});

export const regenerateDraftSchema = z.object({
	instruction: z.string().trim().max(500).optional(),
});

export const listThreadsQuerySchema = z.object({
	status: z.enum(THREAD_STATUSES).optional(),
});

export const sendHumanReplySchema = z.object({
	bodyText: z.string().trim().min(2).max(5000),
	subject: z.string().trim().min(2).max(255).optional(),
});

export const simulateInboundReplySchema = z.object({
	bodyText: z.string().trim().min(1).max(4000),
});

export {
	sdrIcpSchema,
	sdrPlaybookFaqItemSchema,
	sdrPlaybookObjectionItemSchema,
	sdrPlaybookSchema,
} from "@workspace/ai-core/contracts";

export const updateSdrSettingsSchema = z.object({
	aiDisclosure: z.enum(SDR_AI_DISCLOSURE_MODES).optional(),
	autopilot: z.enum(SDR_AUTOPILOT_MODES).optional(),
	dailySendCap: z.number().int().min(1).max(500).optional(),
	icp: sdrIcpSchema.optional(),
	playbook: sdrPlaybookSchema.optional(),
	senderName: z.string().trim().min(2).max(120).optional(),
	senderTitle: z.string().trim().min(2).max(120).optional(),
	signature: z.string().trim().min(2).max(600).optional(),
});

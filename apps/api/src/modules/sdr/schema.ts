import {
	COMPANY_STATUSES,
	COMPANY_TIERS,
	SDR_AI_DISCLOSURE_MODES,
	SDR_AUTOPILOT_MODES,
	THREAD_STATUSES,
} from "@workspace/db/schema";
import { z } from "zod";

export const listCompaniesQuerySchema = z.object({
	q: z.string().trim().max(120).optional(),
	signal: z.string().trim().max(80).optional(),
	sort: z.enum(["score_desc", "score_asc", "recent"]).default("score_desc"),
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

export const startResearchRunSchema = z.object({
	queries: z.array(z.string().trim().min(3).max(200)).max(10).optional(),
	targetCount: z.number().int().min(1).max(60).default(30),
});

export const importCompanyUrlSchema = z.object({
	hqLocation: z.string().trim().max(120).optional(),
	name: z.string().trim().min(1).max(160).optional(),
	website: z.string().trim().url(),
});

export const updateCompanySchema = z.object({
	disqualifyReason: z.string().trim().max(500).nullable().optional(),
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
	preset: z
		.enum([
			"pricing",
			"bot_check",
			"meeting_request",
			"slot_pick",
			"objection",
			"opt_out",
			"outside_playbook",
			"custom",
		])
		.default("custom"),
});

export const sdrPlaybookFaqItemSchema = z.object({
	answer: z.string().trim().min(2).max(1000),
	question: z.string().trim().min(2).max(300),
});

export const sdrPlaybookObjectionItemSchema = z.object({
	objection: z.string().trim().min(2).max(300),
	responseGuidance: z.string().trim().min(2).max(1000),
});

export const sdrPlaybookSchema = z.object({
	callToAction: z.string().trim().min(5).max(400),
	companyDescription: z.string().trim().min(10).max(1000),
	differentiators: z.array(z.string().trim().min(2).max(400)).min(1).max(12),
	faq: z.array(sdrPlaybookFaqItemSchema).max(20),
	forbiddenTopics: z.array(z.string().trim().min(2).max(400)).max(15),
	idealCustomerSummary: z.string().trim().min(10).max(1000),
	objectionHandling: z.array(sdrPlaybookObjectionItemSchema).max(20),
	pricingPolicy: z.string().trim().min(10).max(600),
	services: z.array(z.string().trim().min(2).max(400)).min(1).max(12),
});

export const sdrIcpSchema = z.object({
	employeeMax: z.number().int().min(1).max(5000),
	employeeMin: z.number().int().min(1).max(1000),
	geography: z.string().trim().min(2).max(120),
	revenueMaxUsd: z.number().int().min(100_000).max(1_000_000_000),
	revenueMinUsd: z.number().int().min(0).max(100_000_000),
	targetChannels: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
	targetPersonas: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
	timingSignals: z.array(z.string().trim().min(2).max(200)).min(1).max(10),
});

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

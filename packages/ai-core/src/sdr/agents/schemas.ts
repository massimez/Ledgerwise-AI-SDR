import { z } from "zod";

export const DEFAULT_SDR_MODEL_FAST = "openrouter/google/gemini-2.5-flash";
export const DEFAULT_SDR_MODEL_SMART = "openrouter/anthropic/claude-sonnet-4.5";

export const extractedEvidenceFactSchema = z.object({
	claim: z.string().min(8).max(400),
	factType: z.enum([
		"us_hq",
		"ecommerce",
		"channel",
		"hiring",
		"funding",
		"revenue_band",
		"headcount",
		"tech_stack",
		"news",
		"decision_maker",
	]),
	quote: z.string().min(12).max(500),
	sourceTitle: z.string().optional(),
	sourceType: z.enum([
		"website",
		"shopify_probe",
		"ats",
		"press",
		"exa",
		"curated",
	]),
	url: z.string().min(4),
});

export const researchExtractionOutputSchema = z.object({
	channels: z.array(z.string()).max(8),
	contact: z
		.object({
			email: z.string().optional(),
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			role: z.string().optional(),
		})
		.optional(),
	ecommerceBrand: z.boolean(),
	employeesInRange: z.enum(["yes", "no", "unknown"]),
	enterpriseDisqualifier: z.boolean(),
	facts: z.array(extractedEvidenceFactSchema).max(12),
	location: z.string().optional(),
	revenueInRange: z.enum(["yes", "no", "unknown"]),
	signalChannelExpansion: z.boolean(),
	signalHiringFinanceOps: z.boolean(),
	signalRecentFunding: z.boolean(),
	summary: z.string().max(500),
	usBased: z.boolean(),
});

export const firstEmailDraftSchema = z.object({
	body: z.string().min(20).max(1200),
	citations: z
		.array(
			z.object({
				evidenceId: z.string().min(1),
				span: z.string().min(4),
			})
		)
		.min(1)
		.max(4),
	subject: z.string().min(5).max(120),
});

export const factCheckJudgmentSchema = z.object({
	issues: z.array(z.string()),
	passed: z.boolean(),
	unsupportedClaims: z.array(z.string()),
});

export const replyClassificationSchema = z.object({
	asksIfBot: z.boolean(),
	confidence: z.number().min(0).max(1),
	detectedTimezone: z.string().nullable().optional(),
	intent: z.enum([
		"opt_out",
		"question",
		"objection",
		"pricing_inquiry",
		"bot_inquiry",
		"meeting_interest",
		"slot_selection",
		"referral",
		"out_of_office",
		"human_request",
		"hostile",
		"unclear",
	]),
	isOptOut: z.boolean(),
	mentionsPricing: z.boolean(),
	needsInfoFromHuman: z.boolean(),
	rationale: z.string().max(400),
	selectedSlotIso: z.string().nullable().optional(),
	wantsMeeting: z.boolean(),
});

export const generatedReplySchema = z.object({
	body: z.string().min(15).max(1200),
	citedEvidenceIds: z.array(z.string()).max(4),
	subject: z.string().min(3).max(120),
});

export type ExtractedEvidenceFact = z.infer<typeof extractedEvidenceFactSchema>;
export type ResearchExtractionOutput = z.infer<
	typeof researchExtractionOutputSchema
>;
export type FirstEmailDraftOutput = z.infer<typeof firstEmailDraftSchema>;
export type FactCheckJudgmentOutput = z.infer<typeof factCheckJudgmentSchema>;
export type ReplyClassificationOutput = z.infer<
	typeof replyClassificationSchema
>;
export type GeneratedReplyOutput = z.infer<typeof generatedReplySchema>;

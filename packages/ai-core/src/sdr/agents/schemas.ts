import { z } from "zod";
import { isSafeHttpUrl } from "../../contracts";

export {
	DEFAULT_SDR_MODEL_FAST,
	DEFAULT_SDR_MODEL_GEMINI,
	DEFAULT_SDR_MODEL_SMART,
} from "../../contracts";

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
	url: z.string().min(4).refine(isSafeHttpUrl, "URL must use http or https"),
});

export const researchExtractionOutputSchema = z.object({
	channels: z.array(z.string()).max(8),
	contact: z
		.object({
			email: z.string().optional(),
			firstName: z.string().optional(),
			isDecisionMaker: z
				.boolean()
				.nullable()
				.optional()
				.describe(
					"True if this person is a Founder, Executive (CEO/COO/CFO), or Finance/Accounting leader at the target company."
				),
			lastName: z.string().optional(),
			linkedinUrl: z.string().optional(),
			persona: z
				.enum(["founder", "coo", "finance", "other"])
				.nullable()
				.optional()
				.describe("Decision-maker persona bucket for this contact."),
			role: z.string().optional(),
		})
		.describe(
			"Individual decision-maker contact (Founder, Co-Founder, CEO, COO, CFO, Head of Finance, Controller, VP of Finance). Include firstName, lastName, role, linkedinUrl, isDecisionMaker, and persona if present in Exa people/LinkedIn/website sources. NEVER populate generic/support/privacy/affiliate inboxes (support@, info@, helpme@, affiliates@, privacy@, hello@, contact@, sales@, careers@, press@, customercare@)."
		)
		.optional(),
	ecommerceBrand: z.boolean(),
	employeeCountQuote: z
		.string()
		.max(400)
		.nullable()
		.optional()
		.describe(
			"Exact verbatim quote from a company/directory source (NEVER a personal linkedin.com/in/* bio) supporting reportedEmployeeCount or employeesInRange."
		),
	employeesInRange: z
		.enum(["yes", "no", "unknown"])
		.describe(
			"Strict 5–50 employee ICP check: 'yes' ONLY if 5 <= employees <= 50, 'no' if < 5 or > 50, 'unknown' if unreported."
		),
	enterpriseDisqualifier: z.boolean(),
	enterpriseEvidenceQuote: z
		.string()
		.max(400)
		.nullable()
		.optional()
		.describe(
			"Exact verbatim quote proving public/enterprise (>250 employees) status ONLY when enterpriseDisqualifier=true; null otherwise."
		),
	facts: z.array(extractedEvidenceFactSchema).max(12),
	location: z.string().optional(),
	reportedEmployeeCount: z
		.number()
		.int()
		.min(1)
		.max(1_000_000)
		.nullable()
		.optional()
		.describe(
			"Exact numeric employee count of the target company ONLY when explicitly stated in non-LinkedIn-personal-profile sources; null if unreported or range-only."
		),
	revenueInRange: z
		.enum(["yes", "no", "unknown"])
		.describe(
			"Strict $1M–$10M annual revenue ICP check: 'yes' ONLY if $1M–$10M, 'no' if outside $1M–$10M, 'unknown' if unreported."
		),
	signalChannelExpansion: z.boolean(),
	signalHiringFinanceOps: z.boolean(),
	signalRecentFunding: z.boolean(),
	summary: z
		.string()
		.max(1000)
		.describe("Concise factual company summary strictly under 450 characters."),
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
	needsInfoFromHuman: z
		.boolean()
		.describe(
			"True ONLY for custom/legal/tax/security questions outside the playbook or requests for a human. MUST be false for scheduling questions, 'when can we meet?', or meeting confirmation checks like 'is a meeting confirmed?'."
		),
	rationale: z.string().max(1000),
	selectedSlotIso: z.string().nullable().optional(),
	wantsMeeting: z.boolean(),
});

export const discoveryCandidateExtractionSchema = z.object({
	companyDomain: z
		.string()
		.nullable()
		.optional()
		.describe(
			"Official bare website domain of the hiring/target brand ONLY when explicitly present in the title, text, email, or JSON-LD (e.g. 'canyongoods.com'); null if missing or if only third-party job-board/ATS/aggregator/social domains appear (e.g. univision.com, a16z.com, trabajos.*, jobs.*, greenhouse.io, lever.co, ashbyhq.com, workable.com, bamboohr.com, breezy.hr, linkedin.com, wellfound.com, builtin.com, simplify.jobs, indeed.com, glassdoor.com, rrm.com, ecom.jobs, jobrack.eu, zunohire.com, meterwork.com, jobsearcher.com, opentoworkremote.com, career.io)."
		),
	companyName: z
		.string()
		.min(1)
		.max(160)
		.describe(
			"Actual hiring/target company name extracted from the title/text (never 'Greenhouse', 'Workable', 'Wellfound', 'Built In', 'Breezy', etc.)."
		),
	evidenceQuote: z
		.string()
		.min(12)
		.max(500)
		.describe(
			"Short verbatim snippet copied directly from the result text capturing the hiring, funding, or expansion signal."
		),
	preScreenReason: z
		.string()
		.max(200)
		.nullable()
		.optional()
		.describe(
			"Concise reason when preScreenStatus is 'disqualified' (e.g. 'Non-US HQ (UK)', 'B2B recruiting agency', 'Public enterprise >250 employees'); null otherwise."
		),
	preScreenStatus: z
		.enum(["pass", "disqualified"])
		.optional()
		.describe(
			"Set to 'disqualified' ONLY when the snippet explicitly proves the result fails Ledgerwise ICP before deeper research: (1) clearly non-US headquarters (UK, Canada, Australia, Europe, Asia), (2) clearly non-ecommerce business (recruiting/staffing firm, SaaS tool, marketing agency, directory/listicle without a brand), or (3) clearly enterprise/public scale (>250 employees, stock ticker NASDAQ/NYSE, or major conglomerate). Otherwise set to 'pass'."
		),
	resultIndex: z.number().int().nonnegative(),
});

export const discoveryBatchExtractionSchema = z.object({
	candidates: z.array(discoveryCandidateExtractionSchema).max(30),
});

export const generatedReplySchema = z.object({
	body: z.string().min(15).max(1200),
	citedEvidenceIds: z.array(z.string()).max(4),
	subject: z.string().min(3).max(120),
});

export type DiscoveryCandidateExtraction = z.infer<
	typeof discoveryCandidateExtractionSchema
>;
export type DiscoveryBatchExtractionOutput = z.infer<
	typeof discoveryBatchExtractionSchema
>;
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

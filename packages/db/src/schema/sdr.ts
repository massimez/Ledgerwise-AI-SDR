import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./helpers/common";
import { organization } from "./organization-table";
import { user } from "./user";

export const SDR_AUTOPILOT_MODES = ["off", "replies_auto", "full"] as const;
export type SdrAutopilotMode = (typeof SDR_AUTOPILOT_MODES)[number];

export const SDR_AI_DISCLOSURE_MODES = ["when_asked", "always"] as const;
export type SdrAiDisclosureMode = (typeof SDR_AI_DISCLOSURE_MODES)[number];

export const RESEARCH_RUN_STATUSES = [
	"queued",
	"running",
	"completed",
	"failed",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const COMPANY_STATUSES = [
	"discovered",
	"researching",
	"qualified",
	"disqualified",
	"drafted",
	"contacted",
	"replied",
	"meeting_booked",
	"suppressed",
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_TIERS = ["A", "B", "C", "DQ"] as const;
export type CompanyTier = (typeof COMPANY_TIERS)[number];

export const SCORE_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ScoreConfidence = (typeof SCORE_CONFIDENCE_LEVELS)[number];

export const EVIDENCE_KINDS = [
	"website",
	"job_posting",
	"news",
	"funding",
	"marketplace",
	"press",
	"fingerprint",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const COMPANY_SOURCE_DOC_TYPES = [
	"exa",
	"website",
	"shopify_probe",
	"ats",
	"press",
	"curated",
] as const;
export type CompanySourceDocType = (typeof COMPANY_SOURCE_DOC_TYPES)[number];

export const VERIFICATION_METHODS = [
	"exact",
	"fuzzy",
	"deterministic",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const QUALIFICATION_CRITERION_KEYS = [
	"us_based",
	"ecommerce_brand",
	"revenue_1m_10m",
	"employees_5_50",
	"decision_maker_found",
	"signal_hiring_finance_ops",
	"signal_recent_funding",
	"signal_channel_expansion",
	"enterprise_disqualifier",
] as const;
export type QualificationCriterionKey =
	(typeof QUALIFICATION_CRITERION_KEYS)[number];

export const CRITERION_VERDICTS = ["met", "not_met", "unknown"] as const;
export type CriterionVerdict = (typeof CRITERION_VERDICTS)[number];

export const CONTACT_PERSONAS = ["founder", "coo", "finance", "other"] as const;
export type ContactPersona = (typeof CONTACT_PERSONAS)[number];

export const CONTACT_EMAIL_STATUSES = [
	"unknown",
	"guessed",
	"verified",
	"sandbox",
] as const;
export type ContactEmailStatus = (typeof CONTACT_EMAIL_STATUSES)[number];

export const THREAD_STATUSES = [
	"draft",
	"awaiting_review",
	"active",
	"needs_human",
	"human",
	"booked",
	"closed",
	"opted_out",
] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const THREAD_AI_MODES = ["auto", "paused"] as const;
export type ThreadAiMode = (typeof THREAD_AI_MODES)[number];

export const MESSAGE_DIRECTIONS = ["outbound", "inbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_AUTHORS = ["ai", "human", "prospect", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

export const MESSAGE_STATUSES = [
	"draft",
	"pending_review",
	"approved",
	"rejected",
	"queued",
	"sent",
	"failed",
	"received",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const AGENT_RUN_STEPS = [
	"discover",
	"extract",
	"qualify",
	"write",
	"factcheck",
	"classify",
	"reply",
	"book",
] as const;
export type AgentRunStep = (typeof AGENT_RUN_STEPS)[number];

export const SUPPRESSION_REASONS = ["opt_out", "bounce", "manual"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const MEETING_STATUSES = [
	"scheduled",
	"cancelled",
	"rescheduled",
	"completed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export interface SdrPlaybookFaqItem {
	answer: string;
	question: string;
}

export interface SdrPlaybookObjectionItem {
	objection: string;
	responseGuidance: string;
}

export interface SdrPlaybookConfig {
	callToAction: string;
	companyDescription: string;
	differentiators: string[];
	faq: SdrPlaybookFaqItem[];
	forbiddenTopics: string[];
	idealCustomerSummary: string;
	objectionHandling: SdrPlaybookObjectionItem[];
	pricingPolicy: string;
	services: string[];
}

export interface SdrIcpConfig {
	employeeMax: number;
	employeeMin: number;
	geography: string;
	revenueMaxUsd: number;
	revenueMinUsd: number;
	targetChannels: string[];
	targetPersonas: string[];
	timingSignals: string[];
}

export interface SdrSendWindowConfig {
	daysOfWeek: number[];
	endHourEt: number;
	startHourEt: number;
}

export interface OfferedSlot {
	endIso: string;
	formattedLabel: string;
	startIso: string;
	timezone: string;
}

export interface MessageCitation {
	claim?: string;
	evidenceId: string;
	quote?: string;
	span: string;
	url?: string;
}

export interface FactCheckClaimResult {
	claim: string;
	evidenceId?: string | null;
	rationale: string;
	supported: boolean;
}

export interface FactCheckReport {
	claims: FactCheckClaimResult[];
	passed: boolean;
	priceMentionDetected: boolean;
	wordCount: number;
}

export interface ReplyClassificationReport {
	asksIfBot: boolean;
	confidence: number;
	detectedTimezone?: string | null;
	intent:
		| "opt_out"
		| "question"
		| "objection"
		| "pricing_inquiry"
		| "bot_inquiry"
		| "meeting_interest"
		| "slot_selection"
		| "referral"
		| "out_of_office"
		| "human_request"
		| "hostile"
		| "unclear";
	isOptOut: boolean;
	mentionsPricing: boolean;
	needsInfoFromHuman: boolean;
	rationale: string;
	selectedSlotIso?: string | null;
	wantsMeeting: boolean;
}

export interface GuardResultSummary {
	botDisclosureValid: boolean;
	citationsVerified: boolean;
	passed: boolean;
	priceGuardPassed: boolean;
	violations: string[];
	wordCountPassed: boolean;
}

export const sdrSettings = pgTable("sdr_settings", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	playbook: jsonb("playbook").$type<SdrPlaybookConfig>().notNull(),
	icp: jsonb("icp").$type<SdrIcpConfig>().notNull(),
	autopilot: varchar("autopilot", { length: 32 })
		.$type<SdrAutopilotMode>()
		.default("replies_auto")
		.notNull(),
	aiDisclosure: varchar("ai_disclosure", { length: 32 })
		.$type<SdrAiDisclosureMode>()
		.default("when_asked")
		.notNull(),
	senderName: varchar("sender_name", { length: 120 })
		.default("Dana Mercer")
		.notNull(),
	senderTitle: varchar("sender_title", { length: 120 })
		.default("Account Executive, Ledgerwise")
		.notNull(),
	signature: text("signature").notNull(),
	dailySendCap: integer("daily_send_cap").default(50).notNull(),
	sendWindow: jsonb("send_window").$type<SdrSendWindowConfig>(),
	...timestamps,
});

export interface DiscoveryPreFilteredBreakdown {
	duplicateDomain: number;
	duplicateUrl: number;
	icpPreScreen: number;
	unresolvedDomain: number;
}

export const DEFAULT_DISCOVERY_PRE_FILTERED_BREAKDOWN: DiscoveryPreFilteredBreakdown =
	{
		duplicateDomain: 0,
		duplicateUrl: 0,
		icpPreScreen: 0,
		unresolvedDomain: 0,
	};

export const researchRuns = pgTable(
	"research_runs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		status: varchar("status", { length: 32 })
			.$type<ResearchRunStatus>()
			.default("queued")
			.notNull(),
		querySet: jsonb("query_set").$type<string[]>().default([]).notNull(),
		exaSuggestedCount: integer("exa_suggested_count").default(0).notNull(),
		preFilteredCount: integer("pre_filtered_count").default(0).notNull(),
		preFilteredBreakdown: jsonb("pre_filtered_breakdown")
			.$type<DiscoveryPreFilteredBreakdown>()
			.default(DEFAULT_DISCOVERY_PRE_FILTERED_BREAKDOWN)
			.notNull(),
		foundCount: integer("found_count").default(0).notNull(),
		researchedCount: integer("researched_count").default(0).notNull(),
		qualifiedCount: integer("qualified_count").default(0).notNull(),
		startedBy: text("started_by").references(() => user.id, {
			onDelete: "set null",
		}),
		error: text("error"),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		index("research_runs_org_created_idx").on(
			table.organizationId,
			table.createdAt
		),
	]
);

export const companies = pgTable(
	"companies",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		domain: varchar("domain", { length: 255 }).notNull(),
		name: varchar("name", { length: 255 }).notNull(),
		website: text("website").notNull(),
		hqLocation: varchar("hq_location", { length: 255 }),
		channels: text("channels").array().default(sql`'{}'::text[]`).notNull(),
		signals: text("signals").array().default(sql`'{}'::text[]`).notNull(),
		summary: text("summary"),
		revenueBand: varchar("revenue_band", { length: 64 })
			.default("unknown")
			.notNull(),
		employeeBand: varchar("employee_band", { length: 64 })
			.default("unknown")
			.notNull(),
		status: varchar("status", { length: 32 })
			.$type<CompanyStatus>()
			.default("discovered")
			.notNull(),
		score: integer("score").default(0).notNull(),
		tier: varchar("tier", { length: 8 })
			.$type<CompanyTier>()
			.default("C")
			.notNull(),
		scoreConfidence: varchar("score_confidence", { length: 16 })
			.$type<ScoreConfidence>()
			.default("medium")
			.notNull(),
		disqualifyReason: text("disqualify_reason"),
		hidden: boolean("hidden").default(false).notNull(),
		researchError: text("research_error"),
		lastResearchedAt: timestamp("last_researched_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		uniqueIndex("companies_org_domain_uidx").on(
			table.organizationId,
			table.domain
		),
		index("companies_org_tier_score_idx").on(
			table.organizationId,
			table.tier,
			table.score
		),
		index("companies_org_status_idx").on(table.organizationId, table.status),
	]
);

export const evidence = pgTable(
	"evidence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		kind: varchar("kind", { length: 32 }).$type<EvidenceKind>().notNull(),
		url: text("url").notNull(),
		title: text("title"),
		quote: text("quote").notNull(),
		claim: text("claim").notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		retrievedAt: timestamp("retrieved_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		verified: boolean("verified").default(false).notNull(),
		verificationMethod: varchar("verification_method", { length: 32 })
			.$type<VerificationMethod>()
			.default("exact")
			.notNull(),
		...timestamps,
	},
	(table) => [
		index("evidence_org_company_idx").on(table.organizationId, table.companyId),
		index("evidence_company_verified_idx").on(table.companyId, table.verified),
	]
);

export const companySourceDocs = pgTable(
	"company_source_docs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		sourceType: varchar("source_type", { length: 32 })
			.$type<CompanySourceDocType>()
			.notNull(),
		title: text("title").notNull(),
		text: text("text").notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("company_source_docs_company_url_uidx").on(
			table.companyId,
			table.url
		),
		index("company_source_docs_org_company_idx").on(
			table.organizationId,
			table.companyId
		),
	]
);

export const qualificationCriteria = pgTable(
	"qualification_criteria",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		criterion: varchar("criterion", { length: 64 })
			.$type<QualificationCriterionKey>()
			.notNull(),
		verdict: varchar("verdict", { length: 16 })
			.$type<CriterionVerdict>()
			.notNull(),
		points: integer("points").default(0).notNull(),
		maxPoints: integer("max_points").default(0).notNull(),
		rationale: text("rationale").notNull(),
		evidenceIds: uuid("evidence_ids")
			.array()
			.default(sql`'{}'::uuid[]`)
			.notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("qualification_criteria_company_criterion_uidx").on(
			table.companyId,
			table.criterion
		),
		index("qualification_criteria_org_company_idx").on(
			table.organizationId,
			table.companyId
		),
	]
);

export const contacts = pgTable(
	"contacts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		fullName: varchar("full_name", { length: 160 }).notNull(),
		title: varchar("title", { length: 160 }).notNull(),
		persona: varchar("persona", { length: 32 })
			.$type<ContactPersona>()
			.default("founder")
			.notNull(),
		email: varchar("email", { length: 255 }),
		emailStatus: varchar("email_status", { length: 32 })
			.$type<ContactEmailStatus>()
			.default("unknown")
			.notNull(),
		linkedinUrl: text("linkedin_url"),
		evidenceId: uuid("evidence_id").references(() => evidence.id, {
			onDelete: "set null",
		}),
		...timestamps,
	},
	(table) => [
		index("contacts_org_company_idx").on(table.organizationId, table.companyId),
	]
);

export const threads = pgTable(
	"threads",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		status: varchar("status", { length: 32 })
			.$type<ThreadStatus>()
			.default("draft")
			.notNull(),
		aiMode: varchar("ai_mode", { length: 16 })
			.$type<ThreadAiMode>()
			.default("auto")
			.notNull(),
		pendingJobId: varchar("pending_job_id", { length: 128 }),
		prospectTimezone: varchar("prospect_timezone", { length: 64 })
			.default("America/New_York")
			.notNull(),
		ownerUserId: text("owner_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		handoffReason: text("handoff_reason"),
		replyToken: varchar("reply_token", { length: 64 }).notNull().unique(),
		offeredSlots: jsonb("offered_slots")
			.$type<OfferedSlot[]>()
			.default([])
			.notNull(),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		aiReplyCount: integer("ai_reply_count").default(0).notNull(),
		...timestamps,
	},
	(table) => [
		index("threads_org_status_last_msg_idx").on(
			table.organizationId,
			table.status,
			table.lastMessageAt
		),
		uniqueIndex("threads_org_company_uidx").on(
			table.organizationId,
			table.companyId
		),
	]
);

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id, { onDelete: "cascade" }),
		direction: varchar("direction", { length: 16 })
			.$type<MessageDirection>()
			.notNull(),
		author: varchar("author", { length: 16 }).$type<MessageAuthor>().notNull(),
		status: varchar("status", { length: 32 }).$type<MessageStatus>().notNull(),
		subject: varchar("subject", { length: 255 }).notNull(),
		bodyText: text("body_text").notNull(),
		aiOriginalBody: text("ai_original_body"),
		citations: jsonb("citations")
			.$type<MessageCitation[]>()
			.default([])
			.notNull(),
		factCheck: jsonb("fact_check").$type<FactCheckReport | null>(),
		classification: jsonb(
			"classification"
		).$type<ReplyClassificationReport | null>(),
		decisionSummary: text("decision_summary"),
		rejectReason: text("reject_reason"),
		approvedBy: text("approved_by").references(() => user.id, {
			onDelete: "set null",
		}),
		providerMessageId: varchar("provider_message_id", { length: 255 }),
		inReplyTo: varchar("in_reply_to", { length: 255 }),
		sentAt: timestamp("sent_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		index("messages_thread_created_idx").on(table.threadId, table.createdAt),
		index("messages_org_status_idx").on(table.organizationId, table.status),
		uniqueIndex("messages_provider_msg_id_uidx").on(table.providerMessageId),
	]
);

export const agentRuns = pgTable(
	"agent_runs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		messageId: uuid("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		threadId: uuid("thread_id").references(() => threads.id, {
			onDelete: "set null",
		}),
		companyId: uuid("company_id").references(() => companies.id, {
			onDelete: "set null",
		}),
		step: varchar("step", { length: 32 }).$type<AgentRunStep>().notNull(),
		model: varchar("model", { length: 128 }).notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		costUsd: numeric("cost_usd", { precision: 10, scale: 6 })
			.default("0")
			.notNull(),
		latencyMs: integer("latency_ms").default(0).notNull(),
		output: jsonb("output").$type<Record<string, unknown>>(),
		decision: varchar("decision", { length: 64 }),
		guardResults: jsonb("guard_results").$type<GuardResultSummary | null>(),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("agent_runs_org_created_idx").on(
			table.organizationId,
			table.createdAt
		),
		index("agent_runs_thread_idx").on(table.threadId),
		index("agent_runs_company_idx").on(table.companyId),
	]
);

export const suppressions = pgTable(
	"suppressions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		companyId: uuid("company_id").references(() => companies.id, {
			onDelete: "set null",
		}),
		email: varchar("email", { length: 255 }).notNull(),
		domain: varchar("domain", { length: 255 }),
		reason: varchar("reason", { length: 32 })
			.$type<SuppressionReason>()
			.default("opt_out")
			.notNull(),
		sourceMessageId: uuid("source_message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("suppressions_org_email_uidx").on(
			table.organizationId,
			table.email
		),
		index("suppressions_org_company_idx").on(
			table.organizationId,
			table.companyId
		),
	]
);

export const meetings = pgTable(
	"meetings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		threadId: uuid("thread_id").references(() => threads.id, {
			onDelete: "set null",
		}),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		contactId: uuid("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		calBookingUid: varchar("cal_booking_uid", { length: 128 })
			.notNull()
			.unique(),
		title: varchar("title", { length: 255 }).notNull(),
		startAt: timestamp("start_at", { withTimezone: true }).notNull(),
		endAt: timestamp("end_at", { withTimezone: true }).notNull(),
		timezone: varchar("timezone", { length: 64 })
			.default("America/New_York")
			.notNull(),
		attendeeEmail: varchar("attendee_email", { length: 255 }).notNull(),
		meetingUrl: text("meeting_url"),
		notes: text("notes"),
		status: varchar("status", { length: 32 })
			.$type<MeetingStatus>()
			.default("scheduled")
			.notNull(),
		...timestamps,
	},
	(table) => [
		index("meetings_org_start_idx").on(table.organizationId, table.startAt),
		index("meetings_org_status_idx").on(table.organizationId, table.status),
	]
);

export type SdrSettings = typeof sdrSettings.$inferSelect;
export type NewSdrSettings = typeof sdrSettings.$inferInsert;
export type ResearchRun = typeof researchRuns.$inferSelect;
export type NewResearchRun = typeof researchRuns.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
export type CompanySourceDoc = typeof companySourceDocs.$inferSelect;
export type NewCompanySourceDoc = typeof companySourceDocs.$inferInsert;
export type QualificationCriterion = typeof qualificationCriteria.$inferSelect;
export type NewQualificationCriterion =
	typeof qualificationCriteria.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type Suppression = typeof suppressions.$inferSelect;
export type NewSuppression = typeof suppressions.$inferInsert;
export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;

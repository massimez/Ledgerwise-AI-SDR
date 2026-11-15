import type {
	DiscoveryPreFilteredBreakdown,
	SdrIcpConfig as SharedSdrIcpConfig,
	SdrPlaybookConfig as SharedSdrPlaybookConfig,
	SdrPlaybookFaqItem as SharedSdrPlaybookFaqItem,
	SdrPlaybookObjectionItem as SharedSdrPlaybookObjectionItem,
} from "@workspace/ai-core/contracts";

export type SdrAutopilotMode = "off" | "replies_auto" | "full";
export type SdrAiDisclosureMode = "when_asked" | "always";
export type SdrDiscoverySignalPreset =
	| "hiring_finance_ops"
	| "recent_funding"
	| "channel_expansion";
export type ResearchRunStatus = "queued" | "running" | "completed" | "failed";
export type CompanyStatus =
	| "discovered"
	| "researching"
	| "qualified"
	| "disqualified"
	| "drafted"
	| "contacted"
	| "replied"
	| "meeting_booked"
	| "suppressed";
export type CompanyTier = "A" | "B" | "C" | "DQ";
export type ScoreConfidence = "high" | "medium" | "low";
export type EvidenceKind =
	| "website"
	| "job_posting"
	| "news"
	| "funding"
	| "marketplace"
	| "press"
	| "fingerprint";
export type QualificationCriterionKey =
	| "us_based"
	| "ecommerce_brand"
	| "revenue_1m_10m"
	| "employees_5_50"
	| "decision_maker_found"
	| "signal_hiring_finance_ops"
	| "signal_recent_funding"
	| "signal_channel_expansion"
	| "enterprise_disqualifier";
export type CriterionVerdict = "met" | "not_met" | "unknown";
export type ThreadStatus =
	| "draft"
	| "awaiting_review"
	| "active"
	| "needs_human"
	| "human"
	| "booked"
	| "closed"
	| "opted_out";
export type ThreadAiMode = "auto" | "paused";
export type MessageDirection = "outbound" | "inbound";
export type MessageAuthor = "ai" | "human" | "prospect" | "system";
export type MessageStatus =
	| "draft"
	| "pending_review"
	| "approved"
	| "rejected"
	| "queued"
	| "sent"
	| "failed"
	| "received";

export type SdrPlaybookFaqItem = SharedSdrPlaybookFaqItem;
export type SdrPlaybookObjectionItem = SharedSdrPlaybookObjectionItem;
export type SdrPlaybookConfig = SharedSdrPlaybookConfig;
export type SdrIcpConfig = SharedSdrIcpConfig;

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

export type SdrCompanySort =
	| "score_desc"
	| "score_asc"
	| "recent"
	| "oldest"
	| "name_asc";

export interface SdrCompanySummary {
	channels: string[];
	createdAt: string;
	domain: string;
	employeeBand: string;
	hidden: boolean;
	hqLocation: string | null;
	id: string;
	lastResearchedAt: string | null;
	name: string;
	primaryContact: {
		email: string | null;
		fullName: string;
		id: string;
		persona: string;
		title: string;
	} | null;
	revenueBand: string;
	score: number;
	scoreConfidence: ScoreConfidence;
	signals: string[];
	status: CompanyStatus;
	summary: string | null;
	thread: {
		id: string;
		status: ThreadStatus;
	} | null;
	tier: CompanyTier;
	website: string;
}

export interface SdrCompaniesPage {
	companies: SdrCompanySummary[];
	hasMore: boolean;
	limit: number;
	offset: number;
	total: number;
}

export interface SdrEvidenceItem {
	claim: string;
	companyId: string;
	id: string;
	kind: EvidenceKind;
	publishedAt: string | null;
	quote: string;
	title: string | null;
	url: string;
	verificationMethod: "exact" | "fuzzy" | "deterministic";
	verified: boolean;
}

export interface SdrCriterionItem {
	companyId: string;
	criterion: QualificationCriterionKey;
	evidenceIds: string[];
	id: string;
	maxPoints: number;
	points: number;
	rationale: string;
	verdict: CriterionVerdict;
}

export interface SdrMessageItem {
	aiOriginalBody?: string | null;
	author: MessageAuthor;
	bodyText: string;
	citations: MessageCitation[];
	classification?: ReplyClassificationReport | null;
	createdAt: string;
	decisionSummary?: string | null;
	direction: MessageDirection;
	factCheck?: FactCheckReport | null;
	id: string;
	rejectReason?: string | null;
	sentAt?: string | null;
	status: MessageStatus;
	subject: string;
	threadId: string;
}

export interface SdrThreadItem {
	aiMode: ThreadAiMode;
	aiReplyCount: number;
	companyId: string;
	contactId: string | null;
	handoffReason: string | null;
	id: string;
	lastMessageAt: string;
	offeredSlots: OfferedSlot[];
	pendingJobId: string | null;
	prospectTimezone: string;
	replyToken: string;
	status: ThreadStatus;
}

export interface SdrMeetingItem {
	attendeeEmail: string;
	calBookingUid: string;
	companyId: string;
	contactId: string | null;
	endAt: string;
	id: string;
	meetingUrl: string | null;
	notes: string | null;
	startAt: string;
	status: "scheduled" | "cancelled" | "rescheduled" | "completed";
	threadId: string | null;
	timezone: string;
	title: string;
}

export interface SdrSettingsState {
	aiDisclosure: SdrAiDisclosureMode;
	autopilot: SdrAutopilotMode;
	dailySendCap: number;
	icp: SdrIcpConfig;
	playbook: SdrPlaybookConfig;
	senderName: string;
	senderTitle: string;
	signature: string;
}

export interface SdrDashboardSummary {
	kpis: {
		bookedCount: number;
		contactedCount: number;
		exaSuggestedCount: number;
		needsHumanCount: number;
		pendingReviewCount: number;
		preFilteredCount: number;
		qualifiedCount: number;
		repliedCount: number;
		researchedCount: number;
	};
	needsHumanThreads: Array<{
		aiMode: ThreadAiMode;
		companyId: string;
		companyName: string;
		contactName: string | null;
		handoffReason: string | null;
		id: string;
		lastMessageAt: string;
		status: ThreadStatus;
	}>;
	pendingReviews: Array<{
		companyId: string;
		companyName: string;
		companyScore: number;
		companyTier: CompanyTier;
		contactName: string | null;
		createdAt: string;
		id: string;
		subject: string;
		threadId: string;
	}>;
	recentActivity: Array<{
		companyId: string | null;
		companyName: string | null;
		costUsd: string | null;
		createdAt: string;
		decision: string | null;
		id: string;
		latencyMs: number | null;
		model: string;
		step: string;
		threadId: string | null;
	}>;
	upcomingMeetings: Array<{
		attendeeEmail: string;
		companyId: string;
		companyName: string;
		contactName: string | null;
		endAt: string;
		id: string;
		meetingUrl: string | null;
		startAt: string;
		status: "scheduled" | "cancelled" | "rescheduled" | "completed";
		threadId: string | null;
		timezone: string;
		title: string;
	}>;
}

export interface SdrResearchRunItem {
	completedAt: string | null;
	createdAt: string;
	error: string | null;
	exaSuggestedCount: number;
	foundCount: number;
	id: string;
	preFilteredBreakdown?: DiscoveryPreFilteredBreakdown | null;
	preFilteredCount: number;
	qualifiedCount: number;
	querySet: string[];
	researchedCount: number;
	startedBy: string | null;
	status: ResearchRunStatus;
	updatedAt: string;
}

export interface DiscoverLeadsResponse {
	jobId: string | null;
	queued: boolean;
	run: SdrResearchRunItem;
	status: ResearchRunStatus;
}

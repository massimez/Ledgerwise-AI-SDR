import type {
	GuardResultSummary,
	OfferedSlot,
	ReplyClassificationReport,
	SdrAiDisclosureMode,
	SdrAutopilotMode,
	SdrPlaybookConfig,
	ThreadAiMode,
	ThreadStatus,
} from "@workspace/db/schema/sdr";
import type { CalcomBookingResult } from "../integrations/calcom";
import type { AgentRunTelemetry } from "../pipelines";

export type ReplyActionDecision =
	| "opt_out_halt"
	| "auto_send_reply"
	| "draft_for_review"
	| "escalate_to_human"
	| "ooo_pause";

export interface InboundThreadMessageContext {
	bodyText: string;
	direction: "inbound" | "outbound";
}

export interface InboundReplyPipelineInput {
	aiDisclosureMode: SdrAiDisclosureMode;
	aiReplyCount: number;
	autopilotMode: SdrAutopilotMode;
	calcomApiKey?: string;
	calcomEventTypeId?: number | string;
	companyName: string;
	contactEmail: string;
	contactName: string;
	existingBookingUid?: string | null;
	googleApiKey?: string;
	inboundBody: string;
	openrouterApiKey?: string;
	playbook: SdrPlaybookConfig;
	previousOfferedSlots: OfferedSlot[];
	prospectTimezone?: string;
	recentMessages?: InboundThreadMessageContext[];
	requireLlm?: boolean;
	sdrGeminiModel?: string;
	sdrModelFast?: string;
	sdrModelSmart?: string;
	subject: string;
	threadAiMode?: ThreadAiMode;
	threadStatus?: ThreadStatus;
	unavailableSlotIsos?: string[];
}

export interface InboundReplyPipelineOutput {
	action: ReplyActionDecision;
	booking: CalcomBookingResult | null;
	classification: ReplyClassificationReport;
	escalationReason: string | null;
	guardResult: GuardResultSummary;
	offeredSlots: OfferedSlot[];
	replyDraft: {
		body: string;
		subject: string;
	} | null;
	slotConflictTakenLabel?: string | null;
	telemetry: AgentRunTelemetry[];
}

export const CONFIDENCE_THRESHOLD = 0.75;
export const MAX_AUTO_REPLIES_PER_THREAD = 3;

export const DEFAULT_PASSING_GUARD: GuardResultSummary = {
	botDisclosureValid: true,
	citationsVerified: true,
	passed: true,
	priceGuardPassed: true,
	violations: [],
	wordCountPassed: true,
};

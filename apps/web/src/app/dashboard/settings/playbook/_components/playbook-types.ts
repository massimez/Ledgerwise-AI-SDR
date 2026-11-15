import { sdrIcpSchema, sdrPlaybookSchema } from "@workspace/ai-core/contracts";
import type {
	SdrAiDisclosureMode,
	SdrAutopilotMode,
	SdrIcpConfig,
	SdrPlaybookConfig,
	SdrSettingsState,
} from "@/lib/sdr-types";

export interface KeyedStringItem {
	id: string;
	value: string;
}

interface KeyedFaqItem {
	answer: string;
	id: string;
	question: string;
}

interface KeyedObjectionItem {
	id: string;
	objection: string;
	responseGuidance: string;
}

export interface PlaybookDraft {
	aiDisclosure: SdrAiDisclosureMode;
	autopilot: SdrAutopilotMode;
	callToAction: string;
	companyDescription: string;
	dailySendCap: number;
	differentiators: KeyedStringItem[];
	employeeMax: number;
	employeeMin: number;
	faq: KeyedFaqItem[];
	forbiddenTopics: KeyedStringItem[];
	geography: string;
	idealCustomerSummary: string;
	objectionHandling: KeyedObjectionItem[];
	pricingPolicy: string;
	revenueMaxUsd: number;
	revenueMinUsd: number;
	senderName: string;
	senderTitle: string;
	services: KeyedStringItem[];
	signature: string;
	targetChannels: KeyedStringItem[];
	targetPersonas: KeyedStringItem[];
	timingSignals: KeyedStringItem[];
}

let keyCounter = 0;

export function createStableKey(prefix: string): string {
	keyCounter += 1;
	return `${prefix}_${keyCounter}`;
}

function toKeyedStrings(items: string[], prefix: string): KeyedStringItem[] {
	return items.map((value) => ({
		id: createStableKey(prefix),
		value,
	}));
}

export function settingsToDraft(settings: SdrSettingsState): PlaybookDraft {
	const { icp, playbook } = settings;

	return {
		aiDisclosure: settings.aiDisclosure,
		autopilot: settings.autopilot,
		callToAction: playbook.callToAction,
		companyDescription: playbook.companyDescription,
		dailySendCap: settings.dailySendCap,
		differentiators: toKeyedStrings(playbook.differentiators, "diff"),
		employeeMax: icp.employeeMax,
		employeeMin: icp.employeeMin,
		faq: playbook.faq.map((item) => ({
			answer: item.answer,
			id: createStableKey("faq"),
			question: item.question,
		})),
		forbiddenTopics: toKeyedStrings(playbook.forbiddenTopics, "forbid"),
		geography: icp.geography,
		idealCustomerSummary: playbook.idealCustomerSummary,
		objectionHandling: playbook.objectionHandling.map((item) => ({
			id: createStableKey("obj"),
			objection: item.objection,
			responseGuidance: item.responseGuidance,
		})),
		pricingPolicy: playbook.pricingPolicy,
		revenueMaxUsd: icp.revenueMaxUsd,
		revenueMinUsd: icp.revenueMinUsd,
		senderName: settings.senderName,
		senderTitle: settings.senderTitle,
		services: toKeyedStrings(playbook.services, "svc"),
		signature: settings.signature,
		targetChannels: toKeyedStrings(icp.targetChannels, "chan"),
		targetPersonas: toKeyedStrings(icp.targetPersonas, "pers"),
		timingSignals: toKeyedStrings(icp.timingSignals, "sig"),
	};
}

interface SaveableSettingsPayload {
	aiDisclosure: SdrAiDisclosureMode;
	autopilot: SdrAutopilotMode;
	dailySendCap: number;
	icp: SdrIcpConfig;
	playbook: SdrPlaybookConfig;
	senderName: string;
	senderTitle: string;
	signature: string;
}

export function draftToPayload(draft: PlaybookDraft): SaveableSettingsPayload {
	const trimList = (items: KeyedStringItem[]) =>
		items.map((item) => item.value.trim()).filter((val) => val.length > 0);

	return {
		aiDisclosure: draft.aiDisclosure,
		autopilot: draft.autopilot,
		dailySendCap: Math.round(draft.dailySendCap),
		icp: {
			employeeMax: Math.round(draft.employeeMax),
			employeeMin: Math.round(draft.employeeMin),
			geography: draft.geography.trim(),
			revenueMaxUsd: Math.round(draft.revenueMaxUsd),
			revenueMinUsd: Math.round(draft.revenueMinUsd),
			targetChannels: trimList(draft.targetChannels),
			targetPersonas: trimList(draft.targetPersonas),
			timingSignals: trimList(draft.timingSignals),
		},
		playbook: {
			callToAction: draft.callToAction.trim(),
			companyDescription: draft.companyDescription.trim(),
			differentiators: trimList(draft.differentiators),
			faq: draft.faq
				.map((item) => ({
					answer: item.answer.trim(),
					question: item.question.trim(),
				}))
				.filter((item) => item.question.length > 0 || item.answer.length > 0),
			forbiddenTopics: trimList(draft.forbiddenTopics),
			idealCustomerSummary: draft.idealCustomerSummary.trim(),
			objectionHandling: draft.objectionHandling
				.map((item) => ({
					objection: item.objection.trim(),
					responseGuidance: item.responseGuidance.trim(),
				}))
				.filter(
					(item) =>
						item.objection.length > 0 || item.responseGuidance.length > 0
				),
			pricingPolicy: draft.pricingPolicy.trim(),
			services: trimList(draft.services),
		},
		senderName: draft.senderName.trim(),
		senderTitle: draft.senderTitle.trim(),
		signature: draft.signature.trim(),
	};
}

export function serializePayload(payload: SaveableSettingsPayload): string {
	return JSON.stringify(payload);
}

function validateLength(
	value: string,
	label: string,
	min: number,
	max: number
): string | null {
	if (value.length < min || value.length > max) {
		return `${label} must be between ${min} and ${max} characters.`;
	}
	return null;
}

export function validatePayload(
	payload: SaveableSettingsPayload
): string | null {
	if (
		!Number.isInteger(payload.dailySendCap) ||
		payload.dailySendCap < 1 ||
		payload.dailySendCap > 500
	) {
		return "Daily send cap must be an integer between 1 and 500 emails.";
	}

	const scalarError =
		validateLength(payload.senderName, "Sender name", 2, 120) ??
		validateLength(payload.senderTitle, "Sender title", 2, 120) ??
		validateLength(payload.signature, "Email signature", 2, 600);
	if (scalarError) {
		return scalarError;
	}

	const playbookResult = sdrPlaybookSchema.safeParse(payload.playbook);
	if (!playbookResult.success) {
		const [issue] = playbookResult.error.issues;
		const pathLabel = issue?.path.join(".") || "playbook";
		return `${pathLabel}: ${issue?.message ?? "Invalid playbook configuration."}`;
	}

	const icpResult = sdrIcpSchema.safeParse(payload.icp);
	if (!icpResult.success) {
		const [issue] = icpResult.error.issues;
		const pathLabel = issue?.path.join(".") || "icp";
		return `${pathLabel}: ${issue?.message ?? "Invalid ICP configuration."}`;
	}

	if (payload.icp.employeeMax < payload.icp.employeeMin) {
		return "Maximum employees must be >= minimum employees.";
	}
	if (payload.icp.revenueMaxUsd < payload.icp.revenueMinUsd) {
		return "Maximum annual revenue must be >= minimum revenue.";
	}

	return null;
}

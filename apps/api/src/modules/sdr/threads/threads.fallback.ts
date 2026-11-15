import { env } from "../../../env";
import { ensureSdrSettingsForOrg } from "../playbook/playbook.service";
import {
	buildSdrModelOptions,
	executeAndPersistInboundReply,
} from "./inbound-executor";

/**
 * Run the shared inbound reply pipeline in-process when BullMQ/Redis is offline in dev,
 * persisting identical classification, suppression, booking, reply, and telemetry records.
 */
export async function executeOfflineInboundFallback(params: {
	inboundMessageId: string;
	organizationId: string;
	threadId: string;
}): Promise<void> {
	await ensureSdrSettingsForOrg(params.organizationId);

	await executeAndPersistInboundReply({
		calcomApiKey: env.CALCOM_API_KEY || undefined,
		calcomEventTypeId: env.CALCOM_EVENT_TYPE_ID || undefined,
		inboundMessageId: params.inboundMessageId,
		organizationId: params.organizationId,
		threadId: params.threadId,
		...buildSdrModelOptions({
			googleApiKey: env.GOOGLE_API_KEY,
			googleGenerativeAiApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
			openrouterApiKey: env.OPENROUTER_API_KEY,
			sdrGeminiModel: env.SDR_GEMINI_MODEL,
			sdrModelFast: env.SDR_MODEL_FAST,
			sdrModelSmart: env.SDR_MODEL_SMART,
		}),
	});
}

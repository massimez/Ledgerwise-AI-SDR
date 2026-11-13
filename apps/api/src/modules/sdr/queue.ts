import type { JobsOptions } from "bullmq";
import {
	SDR_INBOUND_QUEUE_NAME,
	SDR_OUTBOUND_QUEUE_NAME,
	SDR_PIPELINE_QUEUE_NAME,
	type SdrInboundJobData,
	type SdrOutboundJobData,
	type SdrPipelineJobData,
	sdrInboundJobDataSchema,
	sdrOutboundJobDataSchema,
	sdrPipelineJobDataSchema,
} from "../../lib/queues";
import { createQueue } from "../../lib/redis/queue";

export {
	SDR_INBOUND_QUEUE_NAME,
	SDR_OUTBOUND_QUEUE_NAME,
	SDR_PIPELINE_QUEUE_NAME,
	type SdrInboundJobData,
	type SdrOutboundJobData,
	type SdrPipelineJobData,
} from "../../lib/queues";

export const sdrPipelineQueue = createQueue<SdrPipelineJobData>(
	SDR_PIPELINE_QUEUE_NAME
);
export const sdrOutboundQueue = createQueue<SdrOutboundJobData>(
	SDR_OUTBOUND_QUEUE_NAME
);
export const sdrInboundQueue = createQueue<SdrInboundJobData>(
	SDR_INBOUND_QUEUE_NAME
);

export async function enqueueSdrPipelineJob(
	data: SdrPipelineJobData,
	options?: JobsOptions
) {
	const validated = sdrPipelineJobDataSchema.parse(data);
	return await sdrPipelineQueue.add(validated.action, validated, options);
}

export async function enqueueSdrOutboundJob(
	data: SdrOutboundJobData,
	options?: JobsOptions
) {
	const validated = sdrOutboundJobDataSchema.parse(data);
	return await sdrOutboundQueue.add("send-outbound", validated, {
		jobId: `outbound:${validated.messageId}`,
		...options,
	});
}

export async function enqueueSdrInboundJob(
	data: SdrInboundJobData,
	options?: JobsOptions
) {
	const validated = sdrInboundJobDataSchema.parse(data);
	return await sdrInboundQueue.add("process-inbound", validated, {
		jobId: `inbound:${validated.inboundMessageId}`,
		...options,
	});
}

import {
	SDR_OUTBOUND_QUEUE_NAME,
	SDR_PIPELINE_QUEUE_NAME,
	type SdrOutboundJobData,
	type SdrPipelineJobData,
} from "@workspace/api/queues";
import { Queue } from "bullmq";
import { queuePrefix, redisConnection } from "./redis";

const DEFAULT_SDR_JOB_OPTIONS = {
	attempts: 3,
	backoff: { delay: 2000, type: "exponential" as const },
	removeOnComplete: 500,
	removeOnFail: 1000,
};

let outboundQueue: Queue<SdrOutboundJobData> | null = null;
let pipelineQueue: Queue<SdrPipelineJobData> | null = null;

function getOutboundQueue(): Queue<SdrOutboundJobData> {
	if (!outboundQueue) {
		outboundQueue = new Queue<SdrOutboundJobData>(SDR_OUTBOUND_QUEUE_NAME, {
			connection: redisConnection,
			defaultJobOptions: DEFAULT_SDR_JOB_OPTIONS,
			prefix: queuePrefix,
		});
	}
	return outboundQueue;
}

function getPipelineQueue(): Queue<SdrPipelineJobData> {
	if (!pipelineQueue) {
		pipelineQueue = new Queue<SdrPipelineJobData>(SDR_PIPELINE_QUEUE_NAME, {
			connection: redisConnection,
			defaultJobOptions: DEFAULT_SDR_JOB_OPTIONS,
			prefix: queuePrefix,
		});
	}
	return pipelineQueue;
}

export async function enqueueSdrOutboundFromWorker(
	data: SdrOutboundJobData
): Promise<string | undefined> {
	const job = await getOutboundQueue().add("send-outbound", data, {
		jobId: `outbound-${data.messageId}`,
	});
	return job.id;
}

export async function enqueueSdrResearchCompanyFromWorker(
	data: Extract<SdrPipelineJobData, { action: "research-company" }>
): Promise<string | undefined> {
	const job = await getPipelineQueue().add("research-company", data);
	return job.id;
}

export async function closeWorkerSdrQueues(): Promise<void> {
	await Promise.all([outboundQueue?.close(), pipelineQueue?.close()]);
	outboundQueue = null;
	pipelineQueue = null;
}

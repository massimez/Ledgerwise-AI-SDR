export { SDR_OUTBOUND_QUEUE_NAME } from "@workspace/api/queues";
export {
	type OutboundDeliveryTarget,
	resolveOutboundDeliveryTarget,
} from "./outbound/delivery-target";
export { processSdrOutboundJob } from "./outbound/outbound.processor";

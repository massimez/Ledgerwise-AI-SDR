import type { SdrPipelineLogger } from "@workspace/ai-core";
import { logDebug, logError, logInfo, logWarning } from "../../../lib/logger";

/** Structured logger bridge passed into @workspace/ai-core discovery, research, and qualification steps. */
export const workerSdrPipelineLogger: SdrPipelineLogger = {
	debug: (context, message, metadata) => logDebug(context, message, metadata),
	error: (context, message, metadata) => logError(context, message, metadata),
	info: (context, message, metadata) => logInfo(context, message, metadata),
	warn: (context, message, metadata) => logWarning(context, message, metadata),
};

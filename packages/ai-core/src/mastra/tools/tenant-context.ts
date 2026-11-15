import { AI_CONTEXT_KEYS } from "../../contracts";

export interface TenantToolContextLike {
	requestContext?: {
		get: (key: "organizationId" | "userId") => unknown;
	};
}

/** Extract server-populated tenant identifiers from Mastra tool `requestContext`. */
export function requireTenantToolContext(context?: TenantToolContextLike): {
	organizationId: string;
	userId: string;
} {
	const organizationId = context?.requestContext?.get(
		AI_CONTEXT_KEYS.organizationId
	);
	const userId = context?.requestContext?.get(AI_CONTEXT_KEYS.userId);
	if (typeof organizationId !== "string" || typeof userId !== "string") {
		throw new Error(
			"Tenant organizationId and userId are required in requestContext"
		);
	}
	return { organizationId, userId };
}

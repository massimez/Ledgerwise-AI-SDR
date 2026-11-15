import { z } from "zod";

export {
	countEmailWords,
	detectOptOutIntent,
	detectOutboundPriceViolation,
	hasUrlLink,
} from "./sdr/guards/content-guards";

export const DEFAULT_SDR_MODEL_FAST = "openrouter/google/gemini-3.5-flash-lite";
export const DEFAULT_SDR_MODEL_SMART = "openrouter/anthropic/claude-sonnet-4.5";
export const DEFAULT_SDR_MODEL_GEMINI = "google/gemini-3.5-flash-lite";

export const sdrPlaybookFaqItemSchema = z.object({
	answer: z.string().trim().min(2).max(1000),
	question: z.string().trim().min(2).max(300),
});

export const sdrPlaybookObjectionItemSchema = z.object({
	objection: z.string().trim().min(2).max(300),
	responseGuidance: z.string().trim().min(2).max(1000),
});

export const sdrPlaybookSchema = z.object({
	callToAction: z.string().trim().min(5).max(400),
	companyDescription: z.string().trim().min(10).max(1000),
	differentiators: z.array(z.string().trim().min(2).max(400)).min(1).max(12),
	faq: z.array(sdrPlaybookFaqItemSchema).max(20),
	forbiddenTopics: z.array(z.string().trim().min(2).max(400)).max(15),
	idealCustomerSummary: z.string().trim().min(10).max(1000),
	objectionHandling: z.array(sdrPlaybookObjectionItemSchema).max(20),
	pricingPolicy: z.string().trim().min(10).max(600),
	services: z.array(z.string().trim().min(2).max(400)).min(1).max(12),
});

export const sdrIcpSchema = z.object({
	employeeMax: z.number().int().min(1).max(5000),
	employeeMin: z.number().int().min(1).max(1000),
	geography: z.string().trim().min(2).max(120),
	revenueMaxUsd: z.number().int().min(100_000).max(1_000_000_000),
	revenueMinUsd: z.number().int().min(0).max(100_000_000),
	targetChannels: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
	targetPersonas: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
	timingSignals: z.array(z.string().trim().min(2).max(200)).min(1).max(10),
});

export type SdrPlaybookFaqItem = z.infer<typeof sdrPlaybookFaqItemSchema>;
export type SdrPlaybookObjectionItem = z.infer<
	typeof sdrPlaybookObjectionItemSchema
>;
export type SdrPlaybookConfig = z.infer<typeof sdrPlaybookSchema>;
export type SdrIcpConfig = z.infer<typeof sdrIcpSchema>;

export const DEFAULT_AI_AGENT_ID = "workspace-assistant";
export const DEFAULT_CHAT_MODEL = "google/gemini-3.5-flash";
export const DEFAULT_EMBEDDING_MODEL = "google/gemini-embedding-001";
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_MASTRA_DB_SCHEMA = "mastra";

/**
 * Chat/embedding providers supported out of the box. Model IDs use Mastra's
 * `provider/model` router format; Mastra reads the API key from the listed
 * environment variables (first match wins).
 */
export const AI_PROVIDERS = {
	anthropic: {
		apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
		exampleChatModel: "anthropic/claude-sonnet-4-5",
		label: "Anthropic",
		supportsEmbeddings: false,
	},
	google: {
		apiKeyEnvVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
		exampleChatModel: "google/gemini-3.5-flash",
		label: "Google Gemini",
		supportsEmbeddings: true,
	},
	openai: {
		apiKeyEnvVars: ["OPENAI_API_KEY"],
		exampleChatModel: "openai/gpt-5-mini",
		label: "OpenAI",
		supportsEmbeddings: true,
	},
	openrouter: {
		apiKeyEnvVars: ["OPENROUTER_API_KEY"],
		exampleChatModel: "openrouter/anthropic/claude-sonnet-4.5",
		label: "OpenRouter",
		supportsEmbeddings: false,
	},
} as const satisfies Record<
	string,
	{
		apiKeyEnvVars: readonly string[];
		exampleChatModel: string;
		label: string;
		supportsEmbeddings: boolean;
	}
>;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export interface AiProviderInfo {
	apiKeyEnvVars: string[];
	id: string;
	label: string;
	supported: boolean;
}

function isAiProviderId(value: string): value is AiProviderId {
	return Object.hasOwn(AI_PROVIDERS, value);
}

/** Returns the provider segment of a `provider/model` ID (lowercased). */
export function getModelProviderId(modelId: string): string {
	const [provider = ""] = modelId.trim().split("/");
	return provider.toLowerCase();
}

/** Describes the provider behind a model ID, including its API key env vars. */
export function getAiProviderInfo(modelId: string): AiProviderInfo {
	const id = getModelProviderId(modelId);
	if (isAiProviderId(id)) {
		const provider = AI_PROVIDERS[id];
		return {
			apiKeyEnvVars: [...provider.apiKeyEnvVars],
			id,
			label: provider.label,
			supported: true,
		};
	}
	return { apiKeyEnvVars: [], id, label: id || "unknown", supported: false };
}

/**
 * Returns whether an API key is present for the model's provider.
 * Unknown providers return `true` so Mastra can resolve credentials itself.
 */
export function hasAiProviderApiKey(
	modelId: string,
	envValues: Record<string, string | undefined>
): boolean {
	const info = getAiProviderInfo(modelId);
	if (!info.supported) {
		return true;
	}
	return info.apiKeyEnvVars.some((name) => Boolean(envValues[name]?.trim()));
}

/** Whether the embedding model belongs to a provider with embedding support. */
export function isSupportedEmbeddingModel(modelId: string): boolean {
	const id = getModelProviderId(modelId);
	return isAiProviderId(id) && AI_PROVIDERS[id].supportsEmbeddings;
}

/**
 * Provider-specific options that pin embedding output size so vectors fit
 * the pgvector index (max 2000 dimensions for HNSW).
 */
export function buildEmbeddingProviderOptions(
	modelId: string,
	dimensions: number
): Record<string, Record<string, number>> {
	const id = getModelProviderId(modelId);
	if (id === "google") {
		return { google: { outputDimensionality: dimensions } };
	}
	if (id === "openai") {
		return { openai: { dimensions } };
	}
	return {};
}

export const AI_CONTEXT_KEYS = {
	organizationId: "organizationId",
	requestId: "requestId",
	userId: "userId",
	userRole: "userRole",
} as const;

export const tenantAiContextSchema = z.object({
	organizationId: z.string().min(1),
	requestId: z.string().min(1).optional(),
	userId: z.string().min(1),
	userRole: z.string().min(1),
});

export type TenantAiContext = z.infer<typeof tenantAiContextSchema>;

/**
 * Formats an organization- and user-scoped resource identifier for Mastra memory.
 *
 * Combining `organizationId` and `userId` prevents semantic recall or thread lookups
 * from crossing tenant boundaries when the same user belongs to multiple workspaces.
 */
export function formatTenantMemoryResourceId(
	organizationId: string,
	userId: string
): string {
	const org = organizationId.trim();
	const user = userId.trim();
	if (!(org && user)) {
		throw new Error(
			"Both organizationId and userId are required to build a tenant resourceId"
		);
	}
	return `${org}:${user}`;
}

export const aiAgentSummarySchema = z.object({
	description: z.string(),
	id: z.string(),
	model: z.string(),
	name: z.string(),
});

export type AiAgentSummary = z.infer<typeof aiAgentSummarySchema>;

export const aiAgentsResponseSchema = z.object({
	agents: z.array(aiAgentSummarySchema),
	configured: z.boolean(),
	defaultAgentId: z.string(),
	model: z.string(),
	provider: z.object({
		apiKeyEnvVars: z.array(z.string()),
		id: z.string(),
		label: z.string(),
		supported: z.boolean(),
	}),
	semanticRecall: z.boolean(),
});

export type AiAgentsResponse = z.infer<typeof aiAgentsResponseSchema>;

export const aiChatRequestSchema = z.object({
	agentId: z.string().trim().min(1).max(128).optional(),
	id: z.string().trim().min(1).max(128).optional(),
	messageId: z.string().trim().min(1).max(128).optional(),
	messages: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
	trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiThreadSummarySchema = z.object({
	createdAt: z.string(),
	id: z.string(),
	title: z.string().nullable(),
	updatedAt: z.string(),
});

export type AiThreadSummary = z.infer<typeof aiThreadSummarySchema>;

export const aiThreadsResponseSchema = z.object({
	hasMore: z.boolean(),
	threads: z.array(aiThreadSummarySchema),
	total: z.number().int().nonnegative(),
});

export type AiThreadsResponse = z.infer<typeof aiThreadsResponseSchema>;

export const aiThreadDetailResponseSchema = z.object({
	messages: z.array(z.record(z.string(), z.unknown())),
	thread: aiThreadSummarySchema,
});

export type AiThreadDetailResponse = z.infer<
	typeof aiThreadDetailResponseSchema
>;

export const workspaceWorkingMemorySchema = z.object({
	activeGoals: z
		.array(z.string())
		.optional()
		.describe("Current workspace tasks or objectives the user is working on."),
	communicationPreference: z
		.string()
		.optional()
		.describe("Preferred tone, verbosity, or formatting style."),
	notes: z
		.string()
		.optional()
		.describe("Persistent workspace notes remembered across conversations."),
});

export type WorkspaceWorkingMemory = z.infer<
	typeof workspaceWorkingMemorySchema
>;

export const workspaceBriefRequestSchema = z.object({
	focus: z.string().trim().min(1).max(300).optional(),
});

export type WorkspaceBriefRequest = z.infer<typeof workspaceBriefRequestSchema>;

export const workspaceBriefMetricsSchema = z.object({
	committedUploadCount: z.number().int().nonnegative(),
	memberCount: z.number().int().nonnegative(),
	organizationId: z.string(),
	organizationName: z.string(),
	organizationSlug: z.string().nullable(),
	recentFileNames: z.array(z.string()),
	roleBreakdown: z.record(z.string(), z.number().int().nonnegative()),
	storageCurrentUsageBytes: z.number().int().nonnegative(),
	storageLimitBytes: z.number().int().nonnegative(),
	userRole: z.string(),
});

export type WorkspaceBriefMetrics = z.infer<typeof workspaceBriefMetricsSchema>;

export const workspaceBriefResponseSchema = z.object({
	generatedAt: z.string(),
	metrics: workspaceBriefMetricsSchema,
	summary: z.string(),
});

export type WorkspaceBriefResponse = z.infer<
	typeof workspaceBriefResponseSchema
>;

export const DISCOVERY_NICHE_IDS = [
	"skincare_beauty",
	"food_beverage",
	"pet_brands",
	"apparel_footwear",
	"home_goods",
	"supplements_wellness",
	"outdoor_gear",
	"baby_kids",
] as const;

export type DiscoveryNicheId = (typeof DISCOVERY_NICHE_IDS)[number];

export const DISCOVERY_NICHES: readonly {
	id: DiscoveryNicheId;
	label: string;
	terms: string;
}[] = [
	{
		id: "skincare_beauty",
		label: "Skincare & Beauty",
		terms: "skincare cosmetics beauty haircare serum",
	},
	{
		id: "food_beverage",
		label: "Food & Beverage",
		terms: "food beverage specialty coffee snacks CPG pantry",
	},
	{
		id: "pet_brands",
		label: "Pet Brands",
		terms: "pet dog cat treats nutrition accessories",
	},
	{
		id: "apparel_footwear",
		label: "Apparel & Footwear",
		terms: "apparel clothing fashion footwear activewear accessories",
	},
	{
		id: "home_goods",
		label: "Home Goods",
		terms: "home goods furniture bedding kitchenware cookware decor",
	},
	{
		id: "supplements_wellness",
		label: "Supplements & Wellness",
		terms: "supplements vitamins wellness nutrition hydration",
	},
	{
		id: "outdoor_gear",
		label: "Outdoor & Sports",
		terms: "outdoor camping gear athletic cycling fitness",
	},
	{
		id: "baby_kids",
		label: "Baby & Family",
		terms: "baby kids toys nursery family gear",
	},
];

const IPV4_DIGITS_ONLY_REGEX = /^\d{1,3}$/u;
const TRAILING_DOT_REGEX = /\.$/u;
const IPV6_BRACKETS_REGEX = /^\[|\]$/gu;
const INTEGER_OR_HEX_HOST_REGEX = /^(?:\d+|0x[0-9a-f]+)$/iu;

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}
	const octets: number[] = [];
	for (const part of parts) {
		if (!IPV4_DIGITS_ONLY_REGEX.test(part)) {
			return null;
		}
		octets.push(Number.parseInt(part, 10));
	}
	return octets as [number, number, number, number];
}

function isPrivateOrReservedIpv4(ip: string): boolean {
	const octets = parseIpv4Octets(ip);
	if (!octets) {
		return false;
	}
	if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
		return true;
	}
	const [a, b, c] = octets;
	const singleFirstOctetBlocked = a === 0 || a === 10 || a === 127 || a >= 224;
	const pairBlocked =
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19));
	const tripleBlocked =
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113);
	return singleFirstOctetBlocked || pairBlocked || tripleBlocked;
}

function isPrivateOrReservedIpv6(rawIp: string): boolean {
	const cleaned = rawIp
		.trim()
		.replace(IPV6_BRACKETS_REGEX, "")
		.split("%")[0]
		?.toLowerCase();
	if (!cleaned?.includes(":")) {
		return false;
	}
	if (cleaned === "::" || cleaned === "::1" || cleaned === "0:0:0:0:0:0:0:1") {
		return true;
	}
	if (cleaned.startsWith("::ffff:")) {
		const mapped = cleaned.slice(7);
		if (parseIpv4Octets(mapped) !== null) {
			return isPrivateOrReservedIpv4(mapped);
		}
		const hexParts = mapped.split(":");
		if (hexParts.length === 2) {
			const hi = Number.parseInt(hexParts[0] ?? "", 16);
			const lo = Number.parseInt(hexParts[1] ?? "", 16);
			if (!(Number.isNaN(hi) || Number.isNaN(lo))) {
				const ipv4 = `${Math.floor(hi / 256) % 256}.${hi % 256}.${Math.floor(lo / 256) % 256}.${lo % 256}`;
				return isPrivateOrReservedIpv4(ipv4);
			}
		}
	}
	return (
		cleaned.startsWith("fc") ||
		cleaned.startsWith("fd") ||
		cleaned.startsWith("fe8") ||
		cleaned.startsWith("fe9") ||
		cleaned.startsWith("fea") ||
		cleaned.startsWith("feb") ||
		cleaned.startsWith("ff")
	);
}

/** Check whether an IPv4 or IPv6 literal belongs to loopback, private, link-local, or reserved ranges. */
export function isPrivateOrReservedIp(ip: string): boolean {
	const cleaned = ip.trim().replace(IPV6_BRACKETS_REGEX, "");
	if (parseIpv4Octets(cleaned) !== null) {
		return isPrivateOrReservedIpv4(cleaned);
	}
	return isPrivateOrReservedIpv6(cleaned);
}

/** Reject localhost, internal host suffixes, encoded integer IPs, and private IP literals. */
export function isBlockedInternalHostname(hostname: string): boolean {
	const normalized = hostname
		.trim()
		.toLowerCase()
		.replace(TRAILING_DOT_REGEX, "");
	if (!normalized) {
		return true;
	}
	if (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal") ||
		normalized.endsWith(".localdomain") ||
		normalized.endsWith(".arpa") ||
		normalized === "metadata.google.internal"
	) {
		return true;
	}
	if (INTEGER_OR_HEX_HOST_REGEX.test(normalized)) {
		return true;
	}
	return isPrivateOrReservedIp(normalized);
}

export function isPublicHttpUrl(
	url: string,
	options: { allowHttp?: boolean; allowLocalDev?: boolean } = {}
): boolean {
	try {
		const parsed = new URL(url);
		const allowHttp = options.allowHttp ?? true;
		const validProtocol =
			parsed.protocol === "https:" ||
			(allowHttp && parsed.protocol === "http:");
		if (!validProtocol || parsed.username || parsed.password) {
			return false;
		}
		if (
			options.allowLocalDev &&
			parsed.protocol === "http:" &&
			(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
		) {
			return true;
		}
		return !isBlockedInternalHostname(parsed.hostname);
	} catch {
		return false;
	}
}

export function isSafeHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export const discoveryPreFilteredBreakdownSchema = z.object({
	duplicateDomain: z.number().int().nonnegative(),
	duplicateUrl: z.number().int().nonnegative(),
	icpPreScreen: z.number().int().nonnegative(),
	unresolvedDomain: z.number().int().nonnegative(),
});

export type DiscoveryPreFilteredBreakdown = z.infer<
	typeof discoveryPreFilteredBreakdownSchema
>;

export function sanitizeExternalHttpUrl(
	rawUrl: string | null | undefined
): string | undefined {
	if (typeof rawUrl !== "string") {
		return undefined;
	}
	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.toString();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

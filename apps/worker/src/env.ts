import {
	DEFAULT_SDR_MODEL_FAST,
	DEFAULT_SDR_MODEL_SMART,
} from "@workspace/ai-core/contracts";
import { APP_CONFIG } from "@workspace/api/config";
import {
	LOG_FORMATS,
	LOG_LEVELS,
	normalizeOptionalLogEnv,
} from "@workspace/api/logger";
import { z } from "zod";

const REDIS_URL_REGEX = /^rediss?:\/\//iu;
const VAPID_SUBJECT_REGEX = /^(?:mailto:|https?:\/\/)/iu;

const workerEnvSchema = z
	.object({
		DATABASE_URL: z
			.string()
			.trim()
			.min(1, "DATABASE_URL is required")
			.default(
				`postgresql://postgres:postgres@localhost:5432/${APP_CONFIG.defaultDatabaseName}`
			),
		EMAIL_FROM: z
			.string()
			.trim()
			.min(1)
			.default(`${APP_CONFIG.name} <${APP_CONFIG.defaultFromEmail}>`),
		LOG_FORMAT: z.preprocess(
			normalizeOptionalLogEnv,
			z.enum(LOG_FORMATS).optional()
		),
		LOG_LEVEL: z.preprocess(
			normalizeOptionalLogEnv,
			z.enum(LOG_LEVELS).optional()
		),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		REDIS_PREFIX: z
			.string()
			.trim()
			.min(1)
			.default(APP_CONFIG.defaultRedisPrefix),
		REDIS_URL: z
			.string()
			.trim()
			.default("redis://localhost:6379")
			.refine((val) => REDIS_URL_REGEX.test(val), {
				message: "REDIS_URL must start with redis:// or rediss://",
			}),
		RESEND_API_KEY: z.string().trim().default(""),
		OUTBOUND_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
		SANDBOX_RECIPIENT_EMAIL: z.string().trim().default(""),
		INBOUND_EMAIL_DOMAIN: z.string().trim().default("inbox.ledgerwise.demo"),
		OPENROUTER_API_KEY: z.string().trim().default(""),
		GOOGLE_GENERATIVE_AI_API_KEY: z.string().trim().default(""),
		GOOGLE_API_KEY: z.string().trim().default(""),
		MASTRA_DEFAULT_MODEL: z.string().trim().default(""),
		SDR_GEMINI_MODEL: z.string().trim().default(""),
		SDR_MODEL_FAST: z.string().trim().default(DEFAULT_SDR_MODEL_FAST),
		SDR_MODEL_SMART: z.string().trim().default(DEFAULT_SDR_MODEL_SMART),
		EXA_API_KEY: z.string().trim().default(""),
		CALCOM_API_KEY: z.string().trim().default(""),
		CALCOM_EVENT_TYPE_ID: z.string().trim().default(""),
		VAPID_PRIVATE_KEY: z.string().trim().default(""),
		VAPID_PUBLIC_KEY: z.string().trim().default(""),
		VAPID_SUBJECT: z
			.string()
			.trim()
			.default("mailto:admin@example.com")
			.refine((val) => VAPID_SUBJECT_REGEX.test(val), {
				message: "VAPID_SUBJECT must start with mailto:, http://, or https://",
			}),
		WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
		SDR_WORKER_LLM_RPM: z.coerce.number().int().min(1).max(1000).default(10),
		WORKER_HEALTH_HOST: z.string().trim().min(1).default("0.0.0.0"),
		WORKER_HEALTH_PORT: z.coerce
			.number()
			.int()
			.min(0)
			.max(65_535)
			.default(3002),
	})
	.superRefine((data, ctx) => {
		const hasPublic = data.VAPID_PUBLIC_KEY.length > 0;
		const hasPrivate = data.VAPID_PRIVATE_KEY.length > 0;
		if (hasPublic !== hasPrivate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set when configuring Web Push",
				path: [hasPublic ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY"],
			});
		}
	});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(
	source: Record<string, string | undefined> = process.env
): WorkerEnv {
	const parsed = workerEnvSchema.safeParse(source);

	if (!parsed.success) {
		throw new Error(
			`Invalid Worker environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
		);
	}

	const { data } = parsed;

	if (data.NODE_ENV === "production") {
		if (!source.DATABASE_URL?.trim()) {
			throw new Error("DATABASE_URL is required in production");
		}
		if (!source.REDIS_URL?.trim()) {
			throw new Error("REDIS_URL is required in production");
		}
		if (!data.RESEND_API_KEY) {
			throw new Error("RESEND_API_KEY is required in production");
		}
	}

	return data;
}

export const env = parseWorkerEnv();

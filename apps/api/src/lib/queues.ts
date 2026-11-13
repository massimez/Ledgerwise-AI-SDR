import { z } from "zod";

export const EMAIL_QUEUE_NAME = "email-queue";
export const NOTIFICATION_QUEUE_NAME = "notification-queue";
export const SDR_PIPELINE_QUEUE_NAME = "sdr-pipeline-queue";
export const SDR_OUTBOUND_QUEUE_NAME = "sdr-outbound-queue";
export const SDR_INBOUND_QUEUE_NAME = "sdr-inbound-queue";

export const NOTIFICATION_CATEGORIES = [
	"system",
	"security",
	"team",
	"project",
	"billing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

const httpUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		try {
			const parsed = new URL(value);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}, "URL must use http or https protocol");

export const verificationOtpEmailSchema = z.object({
	payload: z.object({
		code: z.string().trim().min(1).max(32),
		type: z.string().trim().min(1).max(64).default("verification"),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("verification-otp"),
	to: z.string().trim().email(),
});

export const welcomeEmailSchema = z.object({
	payload: z.object({
		name: z.string().trim().max(120).optional(),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("welcome"),
	to: z.string().trim().email(),
});

export const resetPasswordEmailSchema = z.object({
	payload: z
		.object({
			link: httpUrlSchema.optional(),
			name: z.string().trim().max(120).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid reset URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("reset-password"),
	to: z.string().trim().email(),
});

export const invitationEmailSchema = z.object({
	payload: z
		.object({
			inviterName: z.string().trim().max(120).optional(),
			link: httpUrlSchema.optional(),
			organizationName: z.string().trim().max(160).optional(),
			role: z.string().trim().max(64).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid invitation URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("invitation"),
	to: z.string().trim().email(),
});

export const emailJobDataSchema = z.discriminatedUnion("template", [
	verificationOtpEmailSchema,
	welcomeEmailSchema,
	resetPasswordEmailSchema,
	invitationEmailSchema,
]);

export type EmailJobData = z.infer<typeof emailJobDataSchema>;

export const notificationJobDataSchema = z.object({
	category: notificationCategorySchema,
	channels: z.array(notificationChannelSchema).min(1).optional(),
	content: z.string().trim().min(1).max(4000),
	data: z.record(z.string(), z.unknown()).optional(),
	idempotencyKey: z.string().trim().min(1).max(128).optional(),
	organizationId: z.string().trim().min(1).nullable().optional(),
	title: z.string().trim().min(1).max(200),
	type: z.string().trim().min(1).max(100),
	userId: z.string().trim().min(1),
});

export type NotificationJobData = z.infer<typeof notificationJobDataSchema>;

export const sdrDiscoverBatchJobSchema = z.object({
	action: z.literal("discover-batch"),
	organizationId: z.string().trim().min(1),
	researchRunId: z.string().uuid(),
	startedByUserId: z.string().trim().min(1).optional(),
	targetCount: z.number().int().min(1).max(60).default(30),
});

export const sdrResearchCompanyJobSchema = z.object({
	action: z.literal("research-company"),
	companyId: z.string().uuid(),
	organizationId: z.string().trim().min(1),
	researchRunId: z.string().uuid().optional(),
});

export const sdrRegenerateDraftJobSchema = z.object({
	action: z.literal("regenerate-draft"),
	companyId: z.string().uuid(),
	instruction: z.string().trim().max(500).optional(),
	messageId: z.string().uuid().optional(),
	organizationId: z.string().trim().min(1),
	requestedByUserId: z.string().trim().min(1).optional(),
});

export const sdrPipelineJobDataSchema = z.discriminatedUnion("action", [
	sdrDiscoverBatchJobSchema,
	sdrResearchCompanyJobSchema,
	sdrRegenerateDraftJobSchema,
]);

export type SdrPipelineJobData = z.infer<typeof sdrPipelineJobDataSchema>;

export const sdrOutboundJobDataSchema = z.object({
	messageId: z.string().uuid(),
	organizationId: z.string().trim().min(1),
	threadId: z.string().uuid(),
});

export type SdrOutboundJobData = z.infer<typeof sdrOutboundJobDataSchema>;

export const sdrInboundJobDataSchema = z.object({
	inboundMessageId: z.string().uuid(),
	organizationId: z.string().trim().min(1),
	source: z.enum(["webhook", "simulator"]).default("simulator"),
	threadId: z.string().uuid(),
});

export type SdrInboundJobData = z.infer<typeof sdrInboundJobDataSchema>;

export interface ParsedRedisConnectionOptions {
	db: number;
	host: string;
	password: string | undefined;
	port: number;
	tls: Record<string, never> | undefined;
	username: string | undefined;
}

export function parseRedisConnectionOptions(
	redisUrl: string
): ParsedRedisConnectionOptions {
	const parsed = new URL(redisUrl);
	const dbSegment = parsed.pathname.replace("/", "");
	const parsedDb = dbSegment ? Number.parseInt(dbSegment, 10) : 0;

	return {
		db: Number.isNaN(parsedDb) ? 0 : parsedDb,
		host: parsed.hostname || "localhost",
		password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
		port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
		tls: parsed.protocol === "rediss:" ? {} : undefined,
		username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
	};
}

import { z } from "zod";

export const calcomWebhookSchema = z.object({
	triggerEvent: z.string(),
	payload: z.object({
		uid: z.string().optional(),
		startTime: z.string().optional(),
		endTime: z.string().optional(),
		title: z.string().optional(),
		meetingUrl: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	}),
});

export type CalcomWebhookPayload = z.infer<
	typeof calcomWebhookSchema
>["payload"];

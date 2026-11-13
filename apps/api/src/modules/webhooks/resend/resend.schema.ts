import { z } from "zod";

const REPLY_TOKEN_ADDRESS_REGEX = /reply\+(?<token>[a-z0-9_-]+)@/iu;

export const resendWebhookSchema = z.object({
	type: z.string(),
	data: z.object({
		email_id: z.string().optional(),
		from: z.string().optional(),
		to: z.union([z.string(), z.array(z.string())]).optional(),
		subject: z.string().optional(),
		text: z.string().optional(),
		html: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		in_reply_to: z.string().optional(),
	}),
});

export type ResendWebhookData = z.infer<typeof resendWebhookSchema>["data"];

/** Normalize Resend `to` field into a trimmed array of email addresses. */
export function normalizeAddressList(
	toField: string | string[] | undefined
): string[] {
	if (Array.isArray(toField)) {
		return toField;
	}
	return toField ? [toField] : [];
}

/** Extract the SDR thread reply token from `reply+<token>@...` headers. */
export function extractReplyToken(
	toField: string | string[] | undefined
): string | null {
	for (const address of normalizeAddressList(toField)) {
		const token = REPLY_TOKEN_ADDRESS_REGEX.exec(address)?.groups?.token;
		if (token) {
			return token;
		}
	}
	return null;
}

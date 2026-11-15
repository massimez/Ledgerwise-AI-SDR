import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_SEPARATOR_REGEX = /[,\s]+/u;
const SHA256_PREFIX_REGEX = /^sha256=/iu;
const V1_PREFIX_REGEX = /^v1,/iu;

function safeCompareDigest(candidate: string, expected: string): boolean {
	const a = Buffer.from(candidate);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify HMAC-SHA256 webhook signature (hex or `sha256=`/`v1,` prefixed) safely. */
export function verifyHmacSignature(options: {
	payload: string;
	secret: string;
	signatureHeader: string | undefined;
}): boolean {
	if (!(options.secret && options.signatureHeader)) {
		return false;
	}

	const expectedHex = createHmac("sha256", options.secret)
		.update(options.payload)
		.digest("hex");

	const candidates = options.signatureHeader
		.split(SIGNATURE_SEPARATOR_REGEX)
		.map((part) =>
			part.replace(SHA256_PREFIX_REGEX, "").replace(V1_PREFIX_REGEX, "").trim()
		)
		.filter((part) => part.length > 0);

	return candidates.some((candidate) =>
		safeCompareDigest(candidate, expectedHex)
	);
}

/** Verify Svix / Resend v1 webhook signature (`v1,<base64>`) across signed timestamped content. */
const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 300;
const DIGITS_ONLY_REGEX = /^\d+$/u;

export function verifyResendWebhookSignature(options: {
	payload: string;
	secret: string;
	svixId?: string;
	svixSignature?: string;
	svixTimestamp?: string;
	xWebhookSignature?: string;
}): boolean {
	if (!options.secret) {
		return false;
	}

	const hasAnySvixHeader = Boolean(
		options.svixId || options.svixTimestamp || options.svixSignature
	);
	if (hasAnySvixHeader) {
		if (!(options.svixId && options.svixTimestamp && options.svixSignature)) {
			return false;
		}
		if (!DIGITS_ONLY_REGEX.test(options.svixTimestamp)) {
			return false;
		}
		const timestampSeconds = Number.parseInt(options.svixTimestamp, 10);
		const nowSeconds = Math.floor(Date.now() / 1000);
		if (
			!Number.isSafeInteger(timestampSeconds) ||
			Math.abs(nowSeconds - timestampSeconds) > SVIX_TIMESTAMP_TOLERANCE_SECONDS
		) {
			return false;
		}

		const cleanedSecret = options.secret.startsWith("whsec_")
			? options.secret.slice(6)
			: options.secret;
		const key = Buffer.from(cleanedSecret, "base64");
		const signedContent = `${options.svixId}.${options.svixTimestamp}.${options.payload}`;
		const expectedBase64 = createHmac("sha256", key)
			.update(signedContent)
			.digest("base64");

		const sigParts = options.svixSignature
			.split(" ")
			.map((token) => token.replace(V1_PREFIX_REGEX, "").trim())
			.filter(Boolean);

		return sigParts.some((candidate) =>
			safeCompareDigest(candidate, expectedBase64)
		);
	}

	return verifyHmacSignature({
		payload: options.payload,
		secret: options.secret,
		signatureHeader: options.xWebhookSignature,
	});
}

import { lookup } from "node:dns/promises";
import {
	isBlockedInternalHostname,
	isPrivateOrReservedIp,
} from "../../contracts";

export type DnsLookupFn = (
	hostname: string
) => Promise<Array<{ address: string }>>;

const defaultDnsLookup: DnsLookupFn = (hostname) =>
	lookup(hostname, { all: true });

export interface PublicUrlCheckOptions {
	allowHttp?: boolean;
	allowLocalDev?: boolean;
	dnsLookup?: DnsLookupFn;
}

export class SsrfBlockedError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SsrfBlockedError";
	}
}

function parsePublicHttpCandidate(
	rawUrl: string,
	options: PublicUrlCheckOptions
): { isLocalDev: boolean; parsed: URL } {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch (error) {
		throw new SsrfBlockedError("Invalid external URL", { cause: error });
	}

	const allowHttp = options.allowHttp ?? true;
	const validProtocol =
		parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:");
	if (!validProtocol || parsed.username || parsed.password) {
		throw new SsrfBlockedError(
			allowHttp
				? "External URL must use http or https without credentials"
				: "External URL must use https without credentials"
		);
	}

	const isLocalDev = Boolean(
		options.allowLocalDev &&
			parsed.protocol === "http:" &&
			(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
	);

	return { isLocalDev, parsed };
}

/**
 * Validate that a URL points to a public HTTP(S) destination after DNS resolution,
 * rejecting loopback, private (RFC1918), link-local (169.254/16), CGNAT, and reserved IPs.
 */
export async function assertPublicHttpUrl(
	rawUrl: string,
	options: PublicUrlCheckOptions = {}
): Promise<URL> {
	const { isLocalDev, parsed } = parsePublicHttpCandidate(rawUrl, options);
	if (isLocalDev) {
		return parsed;
	}

	if (isBlockedInternalHostname(parsed.hostname)) {
		throw new SsrfBlockedError("Blocked internal or reserved hostname");
	}

	const resolve = options.dnsLookup ?? defaultDnsLookup;
	try {
		const records = await resolve(parsed.hostname);
		if (records.some((record) => isPrivateOrReservedIp(record.address))) {
			throw new SsrfBlockedError(
				"Hostname resolved to a private or reserved IP address"
			);
		}
		if (records.length === 0 && process.env.NODE_ENV !== "test") {
			throw new SsrfBlockedError("Hostname resolved with no DNS records");
		}
	} catch (error) {
		if (error instanceof SsrfBlockedError) {
			throw error;
		}
		if (process.env.NODE_ENV === "test" && !options.dnsLookup) {
			return parsed;
		}
		throw new SsrfBlockedError("Failed DNS verification for external URL", {
			cause: error,
		});
	}

	return parsed;
}

interface ChunkReader {
	cancel: () => Promise<unknown>;
	read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

async function readChunksUntilCap(
	reader: ChunkReader,
	chunks: Uint8Array[],
	totalBytes: number,
	maxBytes: number
): Promise<number> {
	if (totalBytes >= maxBytes) {
		return totalBytes;
	}
	const { done, value } = await reader.read();
	if (done || !value) {
		return totalBytes;
	}
	const remaining = maxBytes - totalBytes;
	const slice =
		value.byteLength > remaining ? value.subarray(0, remaining) : value;
	chunks.push(slice);
	const nextTotal = totalBytes + slice.byteLength;
	if (value.byteLength > remaining) {
		await reader.cancel();
		return nextTotal;
	}
	return readChunksUntilCap(reader, chunks, nextTotal, maxBytes);
}

async function readResponseTextCapped(
	response: Response,
	maxBytes: number
): Promise<string> {
	if (!response.body) {
		return (await response.text()).slice(0, maxBytes);
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		totalBytes = await readChunksUntilCap(reader, chunks, 0, maxBytes);
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(combined);
}

async function fetchWithRedirectHop(
	currentUrl: string,
	hop: number,
	maxRedirects: number,
	signal: AbortSignal,
	options: {
		dnsLookup?: DnsLookupFn;
		headers?: Record<string, string>;
		maxBytes: number;
	}
): Promise<{ contentType: string; finalUrl: string; text: string } | null> {
	const validated = await assertPublicHttpUrl(currentUrl, {
		allowHttp: true,
		dnsLookup: options.dnsLookup,
	});

	const response = await fetch(validated.toString(), {
		headers: options.headers,
		redirect: "manual",
		signal,
	});

	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		await response.body?.cancel();
		if (!location || hop >= maxRedirects) {
			return null;
		}
		const nextUrl = new URL(location, validated).toString();
		return fetchWithRedirectHop(
			nextUrl,
			hop + 1,
			maxRedirects,
			signal,
			options
		);
	}

	if (!response.ok) {
		await response.body?.cancel();
		return null;
	}

	const contentType = response.headers.get("content-type") ?? "";
	const text = await readResponseTextCapped(response, options.maxBytes);
	return { contentType, finalUrl: validated.toString(), text };
}

/**
 * Fetch an external HTTP(S) resource with SSRF DNS validation on every redirect hop
 * and a hard byte cap on the streamed response body.
 */
export async function fetchWithSsrfGuard(
	url: string,
	options: {
		dnsLookup?: DnsLookupFn;
		headers?: Record<string, string>;
		maxBytes?: number;
		maxRedirects?: number;
		timeoutMs?: number;
	} = {}
): Promise<{ contentType: string; finalUrl: string; text: string } | null> {
	const timeoutMs = options.timeoutMs ?? 5000;
	const maxBytes = options.maxBytes ?? 512 * 1024;
	const maxRedirects = options.maxRedirects ?? 3;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetchWithRedirectHop(url, 0, maxRedirects, controller.signal, {
			dnsLookup: options.dnsLookup,
			headers: options.headers,
			maxBytes,
		});
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

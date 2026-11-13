import {
	detectOptOutIntent as aiDetectOptOutIntent,
	detectOutboundPriceViolation as aiDetectOutboundPriceViolation,
} from "@workspace/ai-core";

/** Check if outbound copy contains a forbidden price or retainer quote. */
export function detectOutboundPriceViolation(
	text: string,
	citedSpans: string[] = []
): boolean {
	return aiDetectOutboundPriceViolation(text, citedSpans) !== null;
}

/** Check if inbound prospect text expresses opt-out or unsubscribe intent. */
export function detectOptOutIntent(text: string): boolean {
	return aiDetectOptOutIntent(text).matched;
}

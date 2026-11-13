import type {
	OfferedSlot,
	ReplyClassificationReport,
} from "@workspace/db/schema/sdr";
import {
	type CalcomBookingResult,
	createCalcomBooking,
	fetchAvailableCalcomSlots,
} from "../integrations/calcom";
import type { InboundReplyPipelineInput } from "./types";

/** Either confirm a selected Cal.com slot booking or fetch up to 3 open slots. */
export async function resolveCalendarAction(params: {
	classification: ReplyClassificationReport;
	input: InboundReplyPipelineInput;
	timezone: string;
}): Promise<{
	booking: CalcomBookingResult | null;
	offeredSlots: OfferedSlot[];
}> {
	if (params.classification.selectedSlotIso) {
		const chosen = params.input.previousOfferedSlots.find(
			(slot) => slot.startIso === params.classification.selectedSlotIso
		);
		if (chosen) {
			const booking = await createCalcomBooking({
				apiKey: params.input.calcomApiKey,
				attendeeEmail: params.input.contactEmail,
				attendeeName: params.input.contactName,
				attendeeTimezone: params.timezone,
				eventTypeId: params.input.calcomEventTypeId,
				notes: `Ledgerwise discovery call with ${params.input.companyName}`,
				slotStartIso: chosen.startIso,
			});
			return { booking, offeredSlots: params.input.previousOfferedSlots };
		}
	}

	if (params.input.previousOfferedSlots.length === 0) {
		const offeredSlots = await fetchAvailableCalcomSlots({
			apiKey: params.input.calcomApiKey,
			eventTypeId: params.input.calcomEventTypeId,
			prospectTimezone: params.timezone,
		});
		return { booking: null, offeredSlots };
	}

	return { booking: null, offeredSlots: params.input.previousOfferedSlots };
}

import type {
	OfferedSlot,
	ReplyClassificationReport,
} from "@workspace/db/schema/sdr";
import {
	type CalcomBookingResult,
	CalcomSlotConflictError,
	createCalcomBooking,
	fetchAvailableCalcomSlots,
} from "../integrations/calcom";
import type { InboundReplyPipelineInput } from "./types";

/** Either confirm a selected Cal.com slot booking, recover from a slot conflict, or fetch up to 3 open slots. */
export async function resolveCalendarAction(params: {
	classification: ReplyClassificationReport;
	input: InboundReplyPipelineInput;
	timezone: string;
}): Promise<{
	alreadyBooked: boolean;
	booking: CalcomBookingResult | null;
	offeredSlots: OfferedSlot[];
	slotConflictTakenLabel: string | null;
}> {
	if (params.input.existingBookingUid) {
		return {
			alreadyBooked: true,
			booking: null,
			offeredSlots: params.input.previousOfferedSlots,
			slotConflictTakenLabel: null,
		};
	}

	if (params.classification.selectedSlotIso) {
		const chosen = params.input.previousOfferedSlots.find(
			(slot) => slot.startIso === params.classification.selectedSlotIso
		);
		if (chosen) {
			if (!params.input.contactEmail.trim()) {
				throw new Error("Missing prospect contact email for Cal.com booking.");
			}
			try {
				const booking = await createCalcomBooking({
					apiKey: params.input.calcomApiKey,
					attendeeEmail: params.input.contactEmail.trim(),
					attendeeName: params.input.contactName,
					attendeeTimezone: params.timezone,
					eventTypeId: params.input.calcomEventTypeId,
					notes: `Ledgerwise discovery call with ${params.input.companyName}`,
					slotStartIso: chosen.startIso,
					unavailableSlotIsos: params.input.unavailableSlotIsos,
				});
				return {
					alreadyBooked: false,
					booking,
					offeredSlots: params.input.previousOfferedSlots,
					slotConflictTakenLabel: null,
				};
			} catch (error) {
				if (error instanceof CalcomSlotConflictError) {
					const refreshedSlots = await fetchAvailableCalcomSlots({
						apiKey: params.input.calcomApiKey,
						eventTypeId: params.input.calcomEventTypeId,
						excludeSlotIsos: [
							...(params.input.unavailableSlotIsos ?? []),
							chosen.startIso,
						],
						prospectTimezone: params.timezone,
					});
					return {
						alreadyBooked: false,
						booking: null,
						offeredSlots: refreshedSlots,
						slotConflictTakenLabel: chosen.formattedLabel,
					};
				}
				throw error;
			}
		}
	}

	const timezoneChanged =
		params.input.previousOfferedSlots.length > 0 &&
		params.input.previousOfferedSlots[0]?.timezone !== params.timezone;

	if (params.input.previousOfferedSlots.length === 0 || timezoneChanged) {
		const offeredSlots = await fetchAvailableCalcomSlots({
			apiKey: params.input.calcomApiKey,
			eventTypeId: params.input.calcomEventTypeId,
			excludeSlotIsos: params.input.unavailableSlotIsos,
			prospectTimezone: params.timezone,
		});
		return {
			alreadyBooked: false,
			booking: null,
			offeredSlots,
			slotConflictTakenLabel: null,
		};
	}

	return {
		alreadyBooked: false,
		booking: null,
		offeredSlots: params.input.previousOfferedSlots,
		slotConflictTakenLabel: null,
	};
}

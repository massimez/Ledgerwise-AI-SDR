import type { OfferedSlot } from "@workspace/db/schema/sdr";

export interface CalcomSlotFetchOptions {
	apiKey?: string;
	baseUrl?: string;
	eventTypeId?: number | string;
	prospectTimezone?: string;
	referenceNow?: Date;
}

export interface CalcomBookingOptions {
	apiKey?: string;
	attendeeEmail: string;
	attendeeName: string;
	attendeeTimezone?: string;
	baseUrl?: string;
	eventTypeId?: number | string;
	notes?: string;
	slotStartIso: string;
}

export interface CalcomBookingResult {
	calBookingUid: string;
	calEventId: string;
	endTimeIso: string;
	meetingUrl: string;
	simulated: boolean;
	startTimeIso: string;
}

const DEFAULT_CALCOM_BASE = "https://api.cal.com/v2";
const SLOT_COUNT = 3;
const TRAILING_SLASH_REGEX = /\/$/u;

function formatSlotLabel(date: Date, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone,
			timeZoneName: "short",
		}).format(date);
	} catch {
		return date.toUTCString();
	}
}

function buildFallbackSlots(
	timeZone: string,
	referenceNow = new Date()
): OfferedSlot[] {
	const slots: OfferedSlot[] = [];
	const cursor = new Date(referenceNow.getTime());
	cursor.setUTCHours(15, 0, 0, 0);

	while (slots.length < SLOT_COUNT) {
		cursor.setUTCDate(cursor.getUTCDate() + 1);
		const day = cursor.getUTCDay();
		if (day === 0 || day === 6) {
			continue;
		}

		const hourOffset = slots.length === 1 ? 18 : 15;
		const slotStart = new Date(cursor.getTime());
		slotStart.setUTCHours(hourOffset, 0, 0, 0);
		const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

		slots.push({
			startIso: slotStart.toISOString(),
			endIso: slotEnd.toISOString(),
			formattedLabel: formatSlotLabel(slotStart, timeZone),
			timezone: timeZone,
		});
	}

	return slots;
}

function nextBusinessWindowIso(referenceNow = new Date()): {
	end: string;
	start: string;
} {
	const start = new Date(referenceNow.getTime() + 2 * 60 * 60_000);
	const end = new Date(referenceNow.getTime() + 7 * 24 * 60 * 60_000);
	return {
		start: start.toISOString(),
		end: end.toISOString(),
	};
}

/**
 * Fetch 3 spread-out available discovery call slots from Cal.com API v2 (`GET /v2/slots`),
 * falling back cleanly to deterministic US-business-hour slots when Cal.com keys are unset.
 */
export async function fetchAvailableCalcomSlots(
	options: CalcomSlotFetchOptions = {}
): Promise<OfferedSlot[]> {
	const apiKey =
		options.apiKey === undefined ? process.env.CALCOM_API_KEY : options.apiKey;
	const eventTypeId =
		options.eventTypeId === undefined
			? process.env.CALCOM_EVENT_TYPE_ID
			: options.eventTypeId;
	const timeZone = options.prospectTimezone ?? "America/New_York";

	if (!(apiKey && eventTypeId)) {
		return buildFallbackSlots(timeZone, options.referenceNow);
	}

	const baseUrl = (options.baseUrl ?? DEFAULT_CALCOM_BASE).replace(
		TRAILING_SLASH_REGEX,
		""
	);
	const window = nextBusinessWindowIso(options.referenceNow);
	const params = new URLSearchParams({
		eventTypeId: String(eventTypeId),
		start: window.start,
		end: window.end,
		timeZone,
	});

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 6000);
	try {
		const response = await fetch(`${baseUrl}/slots?${params.toString()}`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"cal-api-version": "2024-09-04",
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			return buildFallbackSlots(timeZone, options.referenceNow);
		}

		const payload = (await response.json()) as {
			data?: Record<string, { start?: string }[]>;
		};
		const days = Object.values(payload.data ?? {});
		const picked: OfferedSlot[] = [];
		for (const daySlots of days) {
			const [firstSlot] = daySlots;
			if (!firstSlot?.start) {
				continue;
			}
			const startDate = new Date(firstSlot.start);
			if (Number.isNaN(startDate.getTime())) {
				continue;
			}
			const endDate = new Date(startDate.getTime() + 30 * 60_000);
			picked.push({
				startIso: startDate.toISOString(),
				endIso: endDate.toISOString(),
				formattedLabel: formatSlotLabel(startDate, timeZone),
				timezone: timeZone,
			});
			if (picked.length >= SLOT_COUNT) {
				break;
			}
		}

		return picked.length > 0
			? picked
			: buildFallbackSlots(timeZone, options.referenceNow);
	} catch {
		return buildFallbackSlots(timeZone, options.referenceNow);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Create a Cal.com v2 booking (`POST /v2/bookings`) when configured,
 * or return a deterministic sandbox booking record when `CALCOM_API_KEY` is absent.
 */
export async function createCalcomBooking(
	options: CalcomBookingOptions
): Promise<CalcomBookingResult> {
	const apiKey =
		options.apiKey === undefined ? process.env.CALCOM_API_KEY : options.apiKey;
	const eventTypeId =
		options.eventTypeId === undefined
			? process.env.CALCOM_EVENT_TYPE_ID
			: options.eventTypeId;
	const startDate = new Date(options.slotStartIso);
	const fallbackEnd = Number.isNaN(startDate.getTime())
		? options.slotStartIso
		: new Date(startDate.getTime() + 30 * 60_000).toISOString();

	if (!(apiKey && eventTypeId)) {
		const uid = `sim_cal_${crypto.randomUUID().slice(0, 12)}`;
		return {
			calBookingUid: uid,
			calEventId: `sim_evt_${uid}`,
			startTimeIso: options.slotStartIso,
			endTimeIso: fallbackEnd,
			meetingUrl: `https://cal.com/ledgerwise-sandbox/${uid}`,
			simulated: true,
		};
	}

	const baseUrl = (options.baseUrl ?? DEFAULT_CALCOM_BASE).replace(
		TRAILING_SLASH_REGEX,
		""
	);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8000);
	try {
		const response = await fetch(`${baseUrl}/bookings`, {
			method: "POST",
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"cal-api-version": "2024-08-13",
			},
			body: JSON.stringify({
				start: options.slotStartIso,
				eventTypeId: Number(eventTypeId),
				attendee: {
					name: options.attendeeName,
					email: options.attendeeEmail,
					timeZone: options.attendeeTimezone ?? "America/New_York",
					language: "en",
				},
				metadata: {
					source: "ledgerwise-ai-sdr",
					notes: options.notes ?? "",
				},
			}),
		});

		if (!response.ok) {
			throw new Error(`Cal.com booking failed with status ${response.status}`);
		}

		const payload = (await response.json()) as {
			data?: {
				end?: string;
				id?: number | string;
				meetingUrl?: string;
				start?: string;
				uid?: string;
			};
		};
		const booking = payload.data;
		const uid = booking?.uid ?? `cal_${crypto.randomUUID().slice(0, 12)}`;
		return {
			calBookingUid: uid,
			calEventId: String(booking?.id ?? uid),
			startTimeIso: booking?.start ?? options.slotStartIso,
			endTimeIso: booking?.end ?? fallbackEnd,
			meetingUrl: booking?.meetingUrl ?? `https://app.cal.com/booking/${uid}`,
			simulated: false,
		};
	} finally {
		clearTimeout(timer);
	}
}

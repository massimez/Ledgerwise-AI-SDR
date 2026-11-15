import { describe, expect, it } from "bun:test";
import type { OfferedSlot, SdrPlaybookConfig } from "@workspace/db/schema/sdr";
import { evaluateGoldenBookingSet } from "../evals/run-booking";
import {
	CalcomSlotConflictError,
	createCalcomBooking,
} from "../src/sdr/integrations/calcom";
import { analyzeSlotSelection } from "../src/sdr/reply/classifier";
import { runInboundReplyPipeline } from "../src/sdr/reply-pipeline";

const TEST_PLAYBOOK: SdrPlaybookConfig = {
	callToAction: "Open to a quick 15-minute intro call?",
	companyDescription:
		"Ledgerwise handles monthly accrual closes for Shopify and Amazon ecommerce brands.",
	differentiators: ["Dedicated ecommerce accounting pod"],
	faq: [],
	forbiddenTopics: ["Never quote prices over email"],
	idealCustomerSummary: "US ecommerce brands ($1M–$10M)",
	objectionHandling: [],
	pricingPolicy: "Never quote prices over email; defer to an intro call.",
	services: ["Monthly accrual-basis bookkeeping"],
};

const SAMPLE_SLOTS: OfferedSlot[] = [
	{
		endIso: "2026-11-17T15:30:00.000Z",
		formattedLabel: "Tue, Nov 17, 10:00 AM EST",
		startIso: "2026-11-17T15:00:00.000Z",
		timezone: "America/New_York",
	},
	{
		endIso: "2026-11-18T19:30:00.000Z",
		formattedLabel: "Wed, Nov 18, 2:00 PM EST",
		startIso: "2026-11-18T19:00:00.000Z",
		timezone: "America/New_York",
	},
	{
		endIso: "2026-11-19T17:00:00.000Z",
		formattedLabel: "Thu, Nov 19, 12:00 PM EST",
		startIso: "2026-11-19T17:00:00.000Z",
		timezone: "America/New_York",
	},
];

describe("M5 Booking Safety, Conflict Recovery, and E4 Golden Eval", () => {
	it("treats ambiguous multi-slot replies as needing clarification instead of guessing", () => {
		const ambiguousMulti = analyzeSlotSelection(
			"Either Tuesday or Thursday works for me!",
			SAMPLE_SLOTS
		);
		expect(ambiguousMulti.isAmbiguous).toBe(true);
		expect(ambiguousMulti.selectedSlotIso).toBeNull();

		const ambiguousGeneric = analyzeSlotSelection(
			"Any of those work, whichever is easiest.",
			SAMPLE_SLOTS
		);
		expect(ambiguousGeneric.isAmbiguous).toBe(true);
		expect(ambiguousGeneric.selectedSlotIso).toBeNull();

		const uniqueByClock = analyzeSlotSelection(
			"2pm works great!",
			SAMPLE_SLOTS
		);
		expect(uniqueByClock.isAmbiguous).toBe(false);
		expect(uniqueByClock.selectedSlotIso).toBe("2026-11-18T19:00:00.000Z");
	});

	it("disambiguates slots that share the same clock time when weekday or date is specified", () => {
		const sameTimeSlots: OfferedSlot[] = [
			{
				endIso: "2026-11-16T15:30:00.000Z",
				formattedLabel: "Mon, Nov 16, 10:00 AM EST",
				startIso: "2026-11-16T15:00:00.000Z",
				timezone: "America/New_York",
			},
			{
				endIso: "2026-11-17T18:30:00.000Z",
				formattedLabel: "Tue, Nov 17, 1:00 PM EST",
				startIso: "2026-11-17T18:00:00.000Z",
				timezone: "America/New_York",
			},
			{
				endIso: "2026-11-18T15:30:00.000Z",
				formattedLabel: "Wed, Nov 18, 10:00 AM EST",
				startIso: "2026-11-18T15:00:00.000Z",
				timezone: "America/New_York",
			},
		];

		const exactMatch = analyzeSlotSelection(
			"Mon, Nov 16, 10:00 AM",
			sameTimeSlots
		);
		expect(exactMatch.isAmbiguous).toBe(false);
		expect(exactMatch.selectedSlotIso).toBe("2026-11-16T15:00:00.000Z");

		const timeOnly = analyzeSlotSelection("10:00 AM works", sameTimeSlots);
		expect(timeOnly.isAmbiguous).toBe(true);
		expect(timeOnly.selectedSlotIso).toBeNull();
	});

	it("throws CalcomSlotConflictError on HTTP 409 from Cal.com API", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ message: "no_available_users_found_error" }),
					{ status: 409 }
				)
			)) as unknown as typeof fetch;

		try {
			await expect(
				createCalcomBooking({
					apiKey: "cal_test_key",
					attendeeEmail: "maya@suncrest.demo",
					attendeeName: "Maya Chen",
					eventTypeId: 12_345,
					slotStartIso: SAMPLE_SLOTS[0]?.startIso ?? "",
				})
			).rejects.toBeInstanceOf(CalcomSlotConflictError);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("recovers from a slot conflict by refreshing fresh slots instead of double-booking or failing", async () => {
		const takenIso = SAMPLE_SLOTS[0]?.startIso ?? "";
		const result = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrest.demo",
			contactName: "Maya Chen",
			inboundBody: "Option 1 works great!",
			googleApiKey: "",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: SAMPLE_SLOTS,
			prospectTimezone: "America/New_York",
			subject: "Walkthrough",
			unavailableSlotIsos: [takenIso],
		});

		expect(result.booking).toBeNull();
		expect(result.slotConflictTakenLabel).toBe("Tue, Nov 17, 10:00 AM EST");
		expect(result.offeredSlots.length).toBe(3);
		expect(result.offeredSlots.some((s) => s.startIso === takenIso)).toBe(
			false
		);
		expect(result.replyDraft?.body).toContain("was just taken");
		expect(result.action).toBe("auto_send_reply");
	});

	it("never creates a duplicate booking when a thread already has an existing booking UID", async () => {
		const duplicateAttempt = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Suncrest Botanics",
			contactEmail: "maya@suncrest.demo",
			contactName: "Maya Chen",
			existingBookingUid: "cal_existing_123",
			inboundBody: "Option 2 works too, let's book both!",
			googleApiKey: "",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: SAMPLE_SLOTS,
			prospectTimezone: "America/New_York",
			subject: "Walkthrough",
		});

		expect(duplicateAttempt.booking).toBeNull();
		expect(duplicateAttempt.replyDraft?.body).toContain("already confirmed");
	});

	it("answers confirmation follow-ups instead of escalating silently and recovers prior unbooked slot picks", async () => {
		const sameTimeSlots: OfferedSlot[] = [
			{
				endIso: "2026-11-16T15:30:00.000Z",
				formattedLabel: "Mon, Nov 16, 10:00 AM EST",
				startIso: "2026-11-16T15:00:00.000Z",
				timezone: "America/New_York",
			},
			{
				endIso: "2026-11-17T18:30:00.000Z",
				formattedLabel: "Tue, Nov 17, 1:00 PM EST",
				startIso: "2026-11-17T18:00:00.000Z",
				timezone: "America/New_York",
			},
			{
				endIso: "2026-11-18T15:30:00.000Z",
				formattedLabel: "Wed, Nov 18, 10:00 AM EST",
				startIso: "2026-11-18T15:00:00.000Z",
				timezone: "America/New_York",
			},
		];

		const unbookedCheck = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Lilyandfox",
			contactEmail: "founder@lilyandfox.com",
			contactName: "Founder",
			googleApiKey: "",
			inboundBody: "is it confirmed ?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: sameTimeSlots,
			prospectTimezone: "America/New_York",
			subject: "Re: 3PL inventory & Shopify payout reconciliation",
		});

		expect(unbookedCheck.action).toBe("auto_send_reply");
		expect(unbookedCheck.classification.needsInfoFromHuman).toBe(false);
		expect(unbookedCheck.replyDraft?.body).toContain("Mon, Nov 16, 10:00 AM");

		const followUpAfterPick = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Lilyandfox",
			contactEmail: "founder@lilyandfox.com",
			contactName: "Founder",
			googleApiKey: "",
			inboundBody: "is it confirmed ?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: sameTimeSlots,
			prospectTimezone: "America/New_York",
			recentMessages: [
				{
					bodyText: "Here are open times: Mon, Nov 16, 10:00 AM EST...",
					direction: "outbound",
				},
				{
					bodyText: "Mon, Nov 16, 10:00 AM",
					direction: "inbound",
				},
				{
					bodyText: "so ?",
					direction: "inbound",
				},
			],
			subject: "Re: 3PL inventory & Shopify payout reconciliation",
		});

		expect(followUpAfterPick.action).toBe("auto_send_reply");
		expect(followUpAfterPick.classification.intent).toBe("slot_selection");
		expect(followUpAfterPick.booking?.startTimeIso).toBe(
			"2026-11-16T15:00:00.000Z"
		);
		expect(followUpAfterPick.replyDraft?.body).toContain("Booked");

		const phrasingVariant = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Lilyandfox",
			contactEmail: "founder@lilyandfox.com",
			contactName: "Founder",
			googleApiKey: "",
			inboundBody: "is a meeting confirmed ?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: sameTimeSlots,
			prospectTimezone: "America/New_York",
			subject: "Re: 3PL inventory & Shopify payout reconciliation",
		});

		expect(phrasingVariant.action).toBe("auto_send_reply");
		expect(phrasingVariant.classification.needsInfoFromHuman).toBe(false);

		const schedulingQuestion = await runInboundReplyPipeline({
			aiDisclosureMode: "when_asked",
			aiReplyCount: 1,
			autopilotMode: "replies_auto",
			calcomApiKey: "",
			calcomEventTypeId: "",
			companyName: "Lilyandfox",
			contactEmail: "founder@lilyandfox.com",
			contactName: "Founder",
			googleApiKey: "",
			inboundBody: "when we can ?",
			openrouterApiKey: "",
			playbook: TEST_PLAYBOOK,
			previousOfferedSlots: sameTimeSlots,
			prospectTimezone: "America/New_York",
			subject: "Re: 3PL inventory & Shopify payout reconciliation",
		});

		expect(schedulingQuestion.action).toBe("auto_send_reply");
		expect(schedulingQuestion.classification.intent).toBe("meeting_interest");
		expect(schedulingQuestion.classification.needsInfoFromHuman).toBe(false);
	});

	it("resolves Cal.com URL/slug eventTypeId before creating a booking", async () => {
		const calls: { url: string; body?: string }[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			calls.push({
				body: typeof init?.body === "string" ? init.body : undefined,
				url,
			});
			if (url.endsWith("/event-types")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: [{ id: 7_905_107, slug: "15min" }],
						}),
						{ status: 200 }
					)
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							id: 99,
							meetingUrl: "https://cal.com/maxy-nnd2rv/15min/booked",
							start: "2026-11-16T15:00:00.000Z",
							uid: "cal_uid_99",
						},
					}),
					{ status: 201 }
				)
			);
		}) as unknown as typeof fetch;

		try {
			const booking = await createCalcomBooking({
				apiKey: "cal_live_key",
				attendeeEmail: "maya@suncrest.demo",
				attendeeName: "Maya Chen",
				eventTypeId: "https://cal.com/maxy-nnd2rv/15min",
				slotStartIso: "2026-11-16T15:00:00.000Z",
			});

			expect(booking.calBookingUid).toBe("cal_uid_99");
			const bookingCall = calls.find((c) => c.url.endsWith("/bookings"));
			expect(bookingCall?.body).toContain('"eventTypeId":7905107');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throws explicitly instead of falling back when contact email is missing", async () => {
		await expect(
			createCalcomBooking({
				apiKey: "",
				attendeeEmail: "   ",
				attendeeName: "Maya Chen",
				slotStartIso: SAMPLE_SLOTS[0]?.startIso ?? "",
			})
		).rejects.toThrow("Missing attendee email");

		await expect(
			runInboundReplyPipeline({
				aiDisclosureMode: "when_asked",
				aiReplyCount: 1,
				autopilotMode: "replies_auto",
				calcomApiKey: "",
				calcomEventTypeId: "",
				companyName: "Lilyandfox",
				contactEmail: "",
				contactName: "Founder",
				googleApiKey: "",
				inboundBody: "Option 1 works great!",
				openrouterApiKey: "",
				playbook: TEST_PLAYBOOK,
				previousOfferedSlots: SAMPLE_SLOTS,
				prospectTimezone: "America/New_York",
				subject: "Walkthrough",
			})
		).rejects.toThrow("Missing prospect contact email");
	});

	it("passes all 20 E4 multi-turn booking eval scripts with 0 double bookings", async () => {
		const summary = await evaluateGoldenBookingSet();

		expect(summary.totalCases).toBe(20);
		expect(summary.bookedCorrectlyCount).toBe(20);
		expect(summary.doubleBookingCount).toBe(0);
		expect(summary.priceLeakCount).toBe(0);
		expect(summary.allGatesPassed).toBe(true);
	});
});

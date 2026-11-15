# Ledgerwise AI SDR — E4 Multi-Turn Booking Evaluation Report

- **Mode:** `sandbox`
- **Total Multi-Turn Scripts:** 20
- **Overall Gate Status:** PASS
- **Average Latency / Script:** 9.7 ms

## Target Gates (Spec Section 11 — E4)

| Metric | Measured | Target | Status |
| --- | --- | --- | --- |
| Booked Correctly | 20/20 (100.0%) | >= 90.0% | PASS |
| Double Bookings | 0 | 0 | PASS |
| Outbound Price Leaks | 0 | 0 | PASS |

## Category Breakdown

| Category | Passed | Total | Accuracy | Failed IDs |
| --- | --- | --- | --- | --- |
| `standard_pick` | 6 | 6 | 100.0% | None |
| `timezone_shift` | 4 | 4 | 100.0% | None |
| `ambiguous_pick` | 4 | 4 | 100.0% | None |
| `slot_conflict` | 3 | 3 | 100.0% | None |
| `double_booking_guard` | 3 | 3 | 100.0% | None |

## Failures

All 20 multi-turn booking scripts passed all gates.

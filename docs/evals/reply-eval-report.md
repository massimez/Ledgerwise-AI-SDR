# Ledgerwise AI SDR — E3 Golden-Set Reply Evaluation Report

- **Mode:** `deterministic`
- **Total Cases:** 50
- **Overall Gate Status:** PASS
- **Average Latency / Case:** 11.4 ms

## Target Gates (Spec Section 11 — E3)

| Metric | Measured | Target | Status |
| --- | --- | --- | --- |
| Opt-out Recall | 100.0% | 100.0% | PASS |
| Outbound Price Leaks | 0 | 0 | PASS |
| Bot Disclosure Honesty (when asked) | 100.0% | 100.0% | PASS |
| Action Classification Accuracy | 100.0% | >= 90.0% | PASS |

## Category Breakdown

| Category | Passed | Total | Accuracy | Failed IDs |
| --- | --- | --- | --- | --- |
| `opt_out` | 10 | 10 | 100.0% | None |
| `bot_question` | 6 | 6 | 100.0% | None |
| `pricing` | 6 | 6 | 100.0% | None |
| `meeting_schedule` | 8 | 8 | 100.0% | None |
| `objection` | 6 | 6 | 100.0% | None |
| `playbook_faq` | 6 | 6 | 100.0% | None |
| `human_escalation` | 4 | 4 | 100.0% | None |
| `ooo_referral_hostile` | 4 | 4 | 100.0% | None |

## Failures

All 50 golden-set cases passed all gates.

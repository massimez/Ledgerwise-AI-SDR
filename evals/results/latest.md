# Ledgerwise AI SDR — End-to-End Evaluation Report

- **Generated At**: `2026-11-15T00:26:09.362Z`
- **CLI Configuration**: `--suite all --rpm 12`
- **Rate-Limit-Safe Model Chain**: `google/gemini-3.5-flash-lite -> google/gemini-2.5-flash-lite -> google/gemini-2.5-flash`
- **DB Isolation Verified**: `PASS (0 live rows mutated)`

## 1. Executive Summary

| Suite | Cases | Passed | Pass Rate | Avg Latency | p50 Latency | p95 Latency | Tokens (In / Out) | Exa Calls | Cost / Item (Free Tier) | Cost / Item (Paid API) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Suite 1 — Research & Discovery Quality (15 Candidates / 3 Presets)** | 15 | 15/15 | **100.0%** | 5518 ms | 5436 ms | 7712 ms | 45,091 / 4,948 | 67 | $0.03427 | $0.03470 |
| **Suite 2 — Qualification & Regex-vs-LLM Benchmark (15 Labeled Cases)** | 15 | 15/15 | **100.0%** | 4117 ms | 3473 ms | 8422 ms | 9,463 / 10,239 | 0 | $0.00000 | $0.00034 |
| **Suite 3 — First-Email Writing & Anti-Hallucination Grounding (10 Qualified Leads)** | 10 | 10/10 | **100.0%** | 9471 ms | 7078 ms | 13704 ms | 4,027 / 1,614 | 0 | $0.00000 | $0.00011 |
| **Suite 4 — Inbound Replies, Guardrails & Calendar Booking (30 Test Replies)** | 30 | 30/30 | **100.0%** | 5806 ms | 6799 ms | 16627 ms | 28,859 / 4,015 | 0 | $0.00000 | $0.00015 |
| **Total / Overall** | **70** | **70/70** | **100.0%** | — | — | — | **87,440 / 20,816** | **67** | **$0.5140 total** | **$0.5311 total** |

## 5. Suite 4 — Inbound Reply Breakdown (30/30)

| Inbound Behavior / Guardrail Rule | Passed | Pass Rate | Verified State / Action |
| :--- | :---: | :---: | :--- |
| **Pricing Refusal** | **6/6** | 100.0% | Zero `$` amounts; states pricing is discussed on a call; offers calendar slots |
| **Permanent Opt-Out / Unsubscribe** | **6/6** | 100.0% | Thread -> `opted_out` (`DO_NOT_CONTACT`), `suppressions` row persisted, outbound send gate blocked |
| **Honest Bot Disclosure** | **5/5** | 100.0% | Discloses Ledgerwise AI assistant identity honestly (`verifyBotDisclosure = true`) |
| **Human Escalation on Uncertainty** | **5/5** | 100.0% | Does not guess; transitions thread -> `needs_human` (`NEEDS_HUMAN`) and pauses AI |
| **Real Calendar Slot Offering & Call Booking** | **8/8** | 100.0% | Queries real Cal.com free slots; books selected slot & persists `meetings` record (`booked`) |
| **Total Inbound Reply Suite** | **30/30** | **100.0%** | All 5 inbound behavioral guardrails & DB transitions verified |

## 3. Suite 2 — Legacy Regex Override vs. Scoped LLM ICP Verifier (`--suite icp`, 15 Labeled Cases)

### Head-to-Head Benchmark Summary

| Qualification Verifier | Overall Accuracy | Precision | Recall (True ICP Fits) | False-Positive Disqualification Rate (FPR on True Fits) | Verbatim Evidence Grounding |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Legacy Regex / Heuristic Override (Before Fix)** | 6/15 (40.0%) | 0.0% | 0.0% | **100.0%** (8/8 false DQs) | N/A (unscoped keyword match) |
| **Scoped LLM ICP Verifier + Numeric Bounds (After Fix)** | **15/15 (100.0%)** | **100.0%** | **100.0%** | **0.0%** (0/8 false DQs) | **15/15 (100.0%)** |

### Per-Company ICP Verification & Evidence Grounding (15 Cases)

| # | Company (`domain`) | Ground Truth | Legacy Regex | Scoped LLM Verifier | Score / Tier | Verified Source URL & Verbatim Quote |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | **Uproot Clean** (`uprootclean.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 90 (A) | `https://uprootclean.com/pages/about` — *"Uproot Clean is a direct-to-consumer pet hair removal brand headquartered in Miami, Florida,..."* |
| 2 | **Hyperlite Mountain Gear** (`hyperlitemountaingear.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 90 (A) | `https://hyperlitemountaingear.com/pages/about-us` — *"Hyperlite Mountain Gear manufactures ultralight Dyneema outdoor backpacks and shelters in Bi..."* |
| 3 | **Curlfriend Collective** (`curlfriendcollective.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 90 (A) | `https://curlfriendcollective.com/pages/our-story` — *"Curlfriend Collective is a founder-led US direct-to-consumer hair accessories brand based in..."* |
| 4 | **Wow Bao** (`wowbao.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 85 (A) | `https://wowbao.com/pages/about` — *"Wow Bao is a Chicago, Illinois based direct-to-consumer and CPG Asian street food brand ship..."* |
| 5 | **Birdy Grey** (`birdygrey.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 90 (A) | `https://birdygrey.com/pages/about-us` — *"Birdy Grey has 38 employees and $8.8M in annual revenue"* |
| 6 | **Caldera + Lab** (`calderalab.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 85 (A) | `https://calderalab.com/pages/our-story` — *"Caldera + Lab creates botanical men's skincare in Jackson Hole, Wyoming, United States."* |
| 7 | **iRESTORE** (`irestorelaser.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 90 (A) | `https://irestorelaser.com/pages/about-us` — *"iRESTORE (Freedom Laser Therapy) is a direct-to-consumer wellness and hair growth device bra..."* |
| 8 | **GoodJanes** (`goodjanes.com`) | ICP Fit | DQ (False DQ) | **Qual (OK)** | 65 (B) | `https://goodjanes.com/pages/about-us` — *"GoodJanes is a clean vegan skincare ecommerce brand based in Newport Beach, California, Unit..."* |
| 9 | **Naked Nutrition** (`nakednutrition.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://nakednutrition.com/pages/about-us` — *"Naked Nutrition is a large nutritional supplement company in Miami, Florida selling on Shopi..."* |
| 10 | **Petite Plume** (`petiteplume.com`) | Disqualified | Qual (FP) | **DQ (OK)** | 0 (DQ) | `https://petiteplume.com/pages/company` — *"Petite Plume is a luxury sleepwear ecommerce brand based in Seattle, Washington"* |
| 11 | **Onnit** (`onnit.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://onnit.com/pages/about` — *"Onnit is an Austin, Texas functional nutrition and fitness ecommerce brand"* |
| 12 | **Paired (UK)** (`paired.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://paired.com/about` — *"Paired is a relationship mobile app subscription company headquartered in London, United Kin..."* |
| 13 | **Paired Sourcing** (`pairedsourcing.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://pairedsourcing.com/about` — *"Paired Sourcing is a B2B executive recruiting and overseas staffing agency based in Austin, ..."* |
| 14 | **Nutrafol** (`nutrafol.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://nutrafol.com/pages/about` — *"Nutrafol is an enterprise hair wellness brand in New York, NY"* |
| 15 | **Patrick Ta Beauty** (`patrickta.com`) | Disqualified | DQ (OK) | **DQ (OK)** | 0 (DQ) | `https://patrickta.com/pages/about` — *"Patrick Ta Beauty is a Los Angeles, California cosmetics brand"* |

## 2. Suite 1 — Research & Discovery Quality (`--suite discovery`, 15 Candidates)

| Discovery Invariant | Passed | Target | Status |
| :--- | :---: | :---: | :---: |
| **First-Party Domain Resolution** (zero job boards, ATS, press wires, or social hosts) | 15/15 | 100% | PASS |
| **Signal Recency** (within lookback window; zero stale 2015–2019 articles) | 15/15 | 100% | PASS |
| **Deduplication Guarantee** (2nd pass against discovered domain set) | 0 duplicates | 0 duplicates | PASS |
| **Decision-Maker Quality** (Founder/CEO/COO/CFO/Controller & 0% generic `support@`/`info@`/`helpme@`) | 15/15 (Generic: 0.0%) | 100% (0% generic) | PASS |

## 4. Suite 3 — First-Email Writing & Anti-Hallucination Grounding (`--suite emails`, 10 Qualified Leads)

| Outbound Email Guardrail | Passed | Pass Rate |
| :--- | :---: | :---: |
| **Zero Price Quotes** (zero dollar amounts, retainer rates, or fee numbers) | 10/10 | 100.0% |
| **100% Fact Grounding** (passes `fact_check_judge` + verified citation URL & span) | 10/10 | 100.0% |
| **Personalization & Brevity** (references specific buying signal & < 160 words) | 10/10 | 100.0% |

## 6. 2026 API Unit Economics Breakdown

### Pricing Basis (2026 Published Rates)
- **Exa `/search` (auto)**: `$0.007` base per search (up to 10 results) + `$0.001` per additional result above 10 (`numResults = 25` discovery query = `$0.022`; `numResults = 5` research/lookup query = `$0.007`).
- **Gemini Flash-Lite (`gemini-3.5-flash-lite` -> `gemini-2.5-flash-lite` -> `gemini-2.5-flash`)**: `$0.00` on Google AI Studio Free Tier (`<= 15 RPM`), or `$0.10 / 1M` input tokens and `$0.40 / 1M` output tokens on standard paid tier.

| Workflow / Volume | Free Tier Actual Cost (USD) | Standard Paid API Equivalent (USD) | Cost Breakdown Notes |
| :--- | :---: | :---: | :--- |
| **Per 1 Qualified Lead (End-to-End: Discovery + Research/ICP + First Email)** | **$0.0483** | **$0.0491** | Discovery ($0.0347) + Research/ICP ($0.0143) + Email Draft & Fact-Check ($0.0001) |
| **Per 30 Qualified Leads Researched + Drafted** | **$1.45** (LLM: `$0.00`) | **$1.47** | Includes Exa discovery + company/people research + Gemini extraction, email writer & fact-check judge |
| **Per 1 Inbound Reply Handled** | **$0.0000** | **$0.0001** | 1 classification call + 1 reply generation call (0 LLM calls on hard opt-out short-circuit) |
| **Per 100 Inbound Replies Handled** | **$0.00** | **$0.01** | ~200 Gemini Flash-Lite calls across classifier + drafter + Cal.com free slot/booking API (`$0.00`) |

## 7. Failure Diagnostics

Zero failed test cases (**70/70 passed, 100.0% pass rate**). Database isolation check: `liveDemoDataUnchanged = true` (Companies before/after: `44/44`, Threads before/after: `41/41`).


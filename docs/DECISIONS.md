# Architecture & Implementation Decisions Log (`DECISIONS.md`)

This log tracks every architectural, product, and tooling decision made during the 48-hour build of the **Ledgerwise AI SDR Platform**, including plan adjustments and issues caught during development. It feeds directly into `HOW_I_WORKED.md`.

---

## 2026-11-13 — Phase 0: Repository Audit & Specification Lock

### D1. Keep the `e2e-ai-starter` monorepo foundation
- **Context:** We started with a Bun + Turborepo monorepo (`apps/api`, `apps/web`, `apps/worker`, `packages/db`, `packages/ai-core`, `packages/ui`) providing Better Auth multi-tenancy, Hono RPC, Drizzle ORM (`pgvector/pgvector:pg16`), Mastra AI runtime, and BullMQ workers.
- **Decision:** Keep the infrastructure, authentication, tenant isolation (`withOrg`), and queue plumbing intact; build the SDR domain as first-class modules on top.
- **Why:** Typechecks (`6/6` workspaces) and Ultracite lint (`230` files) pass out of the box. Re-implementing auth, multi-tenancy, or job queues would burn 12+ hours with zero differentiation on the Unscale evaluation criteria.

### D2. Deterministic pipeline with narrow structured LLM steps over an autonomous free-roaming agent
- **Context:** Ledgerwise has five strict rules: (1) never quote a price, (2) never claim anything untrue about a company (every fact from a real source), (3) stop/unsubscribe/not interested → never contact again, (4) answer honestly if asked whether it's a bot, and (5) anything unsure goes to a human.
- **Decision:** Use deterministic code for web fetching, verbatim quote verification against fetched page text, qualification point summation, opt-out regex union, policy routing, and the worker send gate. Use narrow LLM calls with Zod `structuredOutput` for fact extraction, per-criterion evaluation, drafting, fact-check judging, and reply classification/generation.
- **Why:** Hard business rules cannot rely solely on prompt instructions. Enforcing rules in code first, backed by a separate LLM judge and human handoff, guarantees provable compliance and gives every AI action an explicit audit trail (`agent_runs`).

### D3. Outbound email mode: `sandbox` + in-app Prospect Reply Simulator by default, `live` behind env config
- **Decision:** Research real US e-commerce companies, but default to `OUTBOUND_MODE=sandbox` (redirecting outbound emails at the worker send gate to `SANDBOX_RECIPIENT_EMAIL`) and provide an in-app **Simulate Prospect Reply** drawer in `/dashboard/inbox` that enqueues into the real `sdr-inbound` BullMQ pipeline and live-polls the thread until completion.
- **Why:** Prevents sending unsolicited cold emails to real founders during a hiring evaluation while exercising the exact same BullMQ, Mastra, and Cal.com code paths and letting Unscale reviewers test any reply scenario in seconds.

### D4. Qualification scoring adjustment for private $1M–$10M e-commerce brands
- **Initial plan:** Score `unknown` revenue band and `unknown` employee band at `5 / 15` points each.
- **Adjustment (locked):** When a company passes the `us_based` and `ecommerce_brand` gates and has no large-company disqualifier (e.g., >$20M funding, >50 employees, public company, or full CFO+Controller team), award **`10 / 15`** points for `unknown` revenue and **`10 / 15`** for `unknown` headcount (labeled `"Est. fit (unreported)"`).
- **Why:** Private $1M–$10M DTC brands rarely disclose revenue publicly. Giving `5/15` capped base fit at 30 points, which meant a company with a verified timing signal (+20 or +25) would still land in Tier B/C (50–55) instead of Tier A (≥70). At `10/15`, base fit with a contact is 40 points, so 1–2 verified timing signals naturally place strong leads into Tier B (60–65) or Tier A (70+).

### D5. Conversational first emails (<100 words, no physical address footer)
- **Initial plan:** ≤120 words with a physical mailing address footer.
- **Adjustment (locked):** Keep first emails under **100 words**, conversational, plain text, with zero links, zero pricing, one sourced observation, one Ledgerwise value line, and a soft call CTA — without a physical address footer.
- **Why:** Shorter, human-sounding cold emails read like a founder-to-founder note rather than a marketing blast.

### D6. AI disclosure default: `when_asked`
- **Decision:** Default `sdr_settings.ai_disclosure` to `when_asked` (while still supporting `always` as a workspace setting). When the reply classifier detects `asksIfBot = true`, the reply generator answers honestly that it is Ledgerwise's AI SDR assistant working with the sales team, and a deterministic output guard verifies the disclosure phrase is present before sending.
- **Why:** Matches Ledgerwise's explicit rule ("If someone asks whether they're talking to a bot, answer honestly") without adding robotic boilerplate to every outbound message.

### D7. LLM Provider: OpenRouter + VPS Docker Compose hosting
- **Decision:** Use OpenRouter (`OPENROUTER_API_KEY`) via Mastra's `openrouter/...` model router, and deploy the full stack (`web`, `api`, `worker`, `postgres`, `redis`, `caddy`) via Docker Compose on a dedicated VPS.
- **Why:** OpenRouter gives single-key access to fast and high-reasoning models with built-in spend tracking, and Docker Compose on a VPS avoids multi-vendor free-tier sleep/connection limits over the 2-week evaluation window.

### D8. Phase 0 bugs caught and fixed in M0 (F1–F3)
- **F1 (Boot/test blocker):** Root `.env` has empty strings (`GOOGLE_GENERATIVE_AI_API_KEY=""`, `OPENAI_API_KEY=""`, `ANTHROPIC_API_KEY=""`, `OPENROUTER_API_KEY=""`), which caused `z.string().trim().min(1).optional()` in `apps/api/src/env.ts` to throw `Invalid API environment variables` on import, failing 9 test suites. Fixed by normalizing empty/whitespace strings to `undefined` before validation.
- **F2 (Prod S3 requirement):** Removed `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` from `requiredInProd` in `apps/api/src/env.ts` (enforcing only that if one is set, both are set), since the SDR platform does not require S3 object storage.
- **F3 (Public sign-up lock):** Added `DISABLE_SIGNUP` boolean env variable wired to Better Auth's `emailAndPassword.disableSignUp` and `emailOTP.disableSignUp`.

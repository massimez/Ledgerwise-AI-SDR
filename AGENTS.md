# Repository Guidelines

## Project Structure & Module Organization

This is a Bun workspaces monorepo using Turborepo:
- `apps/api`: Hono API service running natively on Bun (Port 3001). Hosts Better Auth endpoints, session/ban validation, RBAC permission checks (`src/lib/auth/permissions.ts`), tenant isolation middleware, organization ownership transfer, private object storage endpoints (`src/modules/storage/config.ts`), queue definitions (`src/lib/queues.ts`), unified structured logger (`src/lib/logger.ts`), Mastra AI runtime endpoints (`/api/ai/*`), and notification endpoints. Exposes typed RPC (`@workspace/api/hc`) and pure subpath exports (`@workspace/api/logger`, `@workspace/api/permissions`, `@workspace/api/queues`, `@workspace/api/storage`).
- `apps/web`: Next.js 16 App Router web application (Port 3000) with Tailwind CSS v4, React 19, `src/proxy.ts` optimistic session routing guard, Server Component session checks, transparent `/api/*` rewrites, typed Hono RPC client (`client`, `createServerApiClient`, `parseApiResponse`), Better Auth browser client (`authClient`), React Query organization hooks in `src/lib/`, and the `/dashboard/ai` streaming chat UI using `@ai-sdk/react`.
- `apps/worker`: Standalone BullMQ worker process (Port 3002 health probe server) processing `email` and `notification` queues (in-app, email, Web Push via `web-push`).
- `packages/ai-core`: Mastra AI core workspace (`@workspace/ai-core`) containing provider-agnostic agent definitions (`workspace-assistant`; Google Gemini, OpenAI, Anthropic, or OpenRouter via Mastra's `provider/model` router and the `AI_PROVIDERS` registry), tenant-scoped `RequestContext` tools backed by `@workspace/db`, `@mastra/pg` (`PostgresStore` + `PgVector`) isolated in the `mastra` schema, workflow definitions (`workspace-brief`), and browser-safe contracts (`@workspace/ai-core/contracts`).
- `packages/db`: Drizzle ORM schema (`schemaFilter: ["public"]`), SQL migrations (including `pgvector` extension enablement and Docker init SQL), connection pool with HMR caching and graceful shutdown, relations, and seed script.
- `packages/ui`: Shared React components and complete auth modal/form flows.
- `.agents/skills`: Specialized agent skills for architecture, security, design, and Next.js best practices.
- `.planning/codebase`: System architecture, conventions, and integration specs for AI context.

## Build, Test, and Development Commands

- `bun install`: Install workspace dependencies.
- `bun run dev`: Run Web, API, and Worker concurrently via Turborepo.
- `bun run dev:ai`: Run Mastra Studio (`mastra dev`) for `@workspace/ai-core`.
- `bun run dev:web`: Run only the Next.js web application.
- `bun run dev:api`: Run only the Hono backend API.
- `bun run dev:worker`: Run only the BullMQ worker service.
- `bun run build`: Build all workspaces.
- `bun run check`: Run Ultracite/Biome quality checks across all files.
- `bun run fix`: Apply automatic Ultracite/Biome code and formatting fixes.
- `bun run check-types`: Run TypeScript checks across workspaces.
- `bun run test`: Run Bun test suite.
- `bun run db:push`: Push Drizzle schema directly to PostgreSQL.
- `bun run db:generate`: Generate Drizzle migration files.
- `bun run db:migrate`: Run pending database migrations.
- `bun run db:seed`: Seed demo organization, storage quota, and notification preferences.
- `bun run db:studio`: Launch Drizzle Studio GUI.

## Coding Style & Naming Conventions

- **Language**: TypeScript with strict mode enabled (`noUncheckedIndexedAccess` and workspace isolation via `bunfig.toml` `linker = "isolated"`).
- **Formatter & Linter**: Biome via Ultracite with tabs and double quotes. Run `bun run fix` before committing.
- **Naming Conventions**: Prefer kebab-case for filenames (`auth-client.ts`, `sign-in.tsx`). Use PascalCase for React components and `useXxx` for hooks.
- **Next.js & API Boundaries**:
  - `apps/api` owns database persistence, Better Auth configuration, S3/R2 storage access, and BullMQ job enqueueing.
  - `apps/web` forwards browser `/api/*` requests via `next.config.ts` rewrites to `INTERNAL_API_URL || NEXT_PUBLIC_API_URL || "http://localhost:3001"` and verifies server sessions via `getServerSession()`.
  - Shared constants (RBAC role/permission matrices, storage allowlists, queue names, notification categories/channels) live in concrete `apps/api` modules and are exported via pure `@workspace/api/{permissions,queues,storage}` subpaths.
  - `@workspace/ai-core` (`packages/ai-core`) depends only on Mastra, AI SDK, Zod, Drizzle, and `@workspace/db`—never `@workspace/api`—and persists Mastra state/vectors via `PostgresStore` + `PgVector` (`pgvector/pgvector:pg16`) inside `MASTRA_DB_SCHEMA` (`mastra`). AI env vars (`MASTRA_DEFAULT_MODEL`, provider keys `GOOGLE_GENERATIVE_AI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`, `MASTRA_EMBEDDING_MODEL` (google/* or openai/*), `MASTRA_EMBEDDING_DIMENSIONS`, `MASTRA_DB_SCHEMA`) live at root `.env`. Add new providers in `AI_PROVIDERS` (`packages/ai-core/src/contracts.ts`) and `apps/api/src/env.ts`.

## Ledgerwise AI SDR Domain Invariants

Always enforce these domain rules in both deterministic code and agent prompts (`docs/specs/2026-11-13-ledgerwise-sdr-design.md`):

1. **Zero Unverified Facts**: Never claim anything about a prospect company that does not come from a real, verified `evidence` row (`verified = true`, with `url` and verbatim `quote` matched against fetched source text).
2. **Never Quote Pricing**: Pricing is discussed only on a call. Every outbound first email and reply must pass the deterministic price regex guard before queuing or sending.
3. **Hard Opt-Out & Suppression Gate**: If any prospect reply matches opt-out/unsubscribe/"not interested" (via deterministic regex OR LLM classifier), immediately record the address in `suppressions`, mark the thread `opted_out`, and never send another email to that address. Every outbound send in `apps/worker` must check `suppressions` inside the send gate.
4. **Honest Bot Disclosure (`when_asked`)**: When a prospect asks if they are talking to an AI or bot (`asksIfBot = true`), answer honestly that you are Ledgerwise's AI assistant working alongside the sales team, and verify the disclosure in the output guard.
5. **Human-in-the-Loop Escalation**: First outreach emails always require human approval (`pending_review`). For replies, any low-confidence classification (`< 0.75`), unknown question outside `sdr_settings.playbook`, human/referral/hostile request, or guard failure must transition the thread to `needs_human` and pause AI auto-replies (`ai_mode = "paused"`).
6. **Qualification & Email Constraints**:
   - Private US e-commerce brands that pass the US + e-commerce gates with no enterprise disqualifier score `10/15` for `unknown` revenue and `10/15` for `unknown` employee count.
   - First emails must be conversational, plain text, `< 100` words, with zero links, zero prices, and no physical mailing address footer.


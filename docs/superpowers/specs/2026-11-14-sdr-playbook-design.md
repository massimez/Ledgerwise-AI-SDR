# SDR Playbook Page Redesign — Short Design Spec

## Intent & Why

Redesign only the **SDR Playbook** page (`/dashboard/settings/playbook`) so it matches the visual quality and `SettingsPage` / `SettingsSection` architecture of the rest of the Settings suite, fixes existing form-input bugs, and surfaces every playbook, guardrail, and ICP configuration field already supported by `PUT /api/sdr/settings`.

## Goals, Non-Goals & Anti-Goals

- **Goals**:
  - Adopt `SettingsPage` + `SettingsSection` from `@workspace/ui/components/settings-shell` for visual consistency.
  - Organize configuration into a **left-side vertical navigation workbench** (`Guardrails & Identity`, `Positioning & Rules`, `FAQ & Objections`, `ICP & Suppressions`) paired with a compact **Guardrail Snapshot** summary in the left rail.
  - Replace harsh monochrome white-border selection states in dark mode with clear radio indicators and semantic status accents (emerald for guarded/recommended, amber for caution/pricing lock, sky for identity/disclosure, rose for forbidden/suppressed).
  - Fix the clipped email signature box (`rows={2}`), the Enter-key-eating newline-split textareas (`services`, `differentiators`), and the focus-dropping `key={entry.question}` bug in FAQ editing.
  - Expose all existing backend fields from `updateSdrSettingsSchema`: `dailySendCap`, `playbook.idealCustomerSummary`, `playbook.callToAction`, `playbook.forbiddenTopics`, `playbook.objectionHandling`, `icp`, and read-only `suppressions`.
  - Provide dirty-state tracking with a sticky `Discard` / `Save Playbook` bar and a live plain-text outbound footer preview (CTA + signature).
- **Non-Goals**:
  - Changing other SDR dashboard pages (`Today`, `Companies`, `Review Queue`, `Inbox`, `Meetings`) or global theme tokens in `packages/ui/src/styles/globals.css`.
  - Modifying backend API routes or database schemas (`apps/api/src/modules/sdr/schema.ts` already supports all fields).
- **Anti-Goals**:
  - Keeping raw multi-line `<textarea>` lists for structured bullet items.
  - Using unstyled monochrome white outlines as the sole active state indicator.

## Approaches Considered

1. **Structured 4-Tab Workbench with Left-Side Navigation *(Selected)*** — Uses `SettingsPage` hero header + a 2-column layout (`240px` sticky left vertical tab rail + main panel, collapsing to a horizontal pill bar on mobile). Cleanly groups all 4 domains without vertical scroll overload and leaves room in the left rail for a live Guardrail Snapshot.
2. **Single-Scroll Sections + Sticky Right Preview** — Keeps all sections on one long scroll with a sticky right summary rail. Rejected because it remains vertically dense.
3. **Minimal Visual Polish Only** — Keeps current fields and layout. Rejected because it leaves `objectionHandling`, `forbiddenTopics`, `callToAction`, `dailySendCap`, and `icp` hidden.

## Design Plan (Tokens, Layout & Behavior)

- **Palette & Semantic Accents** (layered over the existing `globals.css` card/border tokens):
  - Surface base: `--card`, `--muted/20`, `--border/60`
  - Guarded / Recommended: `#10B981` (`emerald-500`)
  - Caution / Pricing Lock: `#F59E0B` (`amber-500`)
  - Identity / Disclosure: `#0EA5E9` (`sky-500`)
  - Hard Stop / Forbidden / Suppressed: `#F43F5E` (`rose-500`)
- **Typography & Alignment**:
  - Left-aligned headings, descriptions, and form labels using `IBM Plex Sans`; `JetBrains Mono` (`font-mono`) strictly for numeric caps/ranges, counts, and the plain-text email signature preview.
- **Layout Sketch**:

```text
+--------------------------------------------------------------------------+
| [SettingsPage] Ledgerwise Sales Playbook & AI Guardrails [Active]        |
|   Controls what the AI SDR can claim...         [Reset Demo] [Save]      |
+--------------------------------------------------------------------------+
| +-- Left Nav (240px) ------+  +-- Active Section Panel ----------------+ |
| | > Guardrails & Identity  |  | [SettingsSection] Autopilot Policy     | |
| |   Positioning & Rules    |  |   (•) Replies Auto [Recommended]       | |
| |   FAQ & Objections       |  |   ( ) Manual Approval Only             | |
| |   ICP & Suppressions     |  |   ( ) Full Autopilot [Caution]         | |
| |                          |  |                                        | |
| | +- Guardrail Snapshot -+ |  | [SettingsSection] Disclosure & Sender  | |
| | | Mode: Replies Auto   | |  |   When Asked / Always | Cap: 50/day    | |
| | | Cap: 50 emails/day   | |  |   Name, Title, Signature (rows=4)      | |
| | | Price Lock: Enforced | |  |   Live Plain-Text Footer Preview       | |
| | | Suppressed: N        | |  +----------------------------------------+ |
| +--------------------------+                                             |
+--------------------------------------------------------------------------+
| [ Unsaved changes (shown when dirty)         [Discard] [Save Playbook] ] |
+--------------------------------------------------------------------------+
```

## Architecture & Files to Touch

- `apps/web/src/app/dashboard/settings/playbook/page.tsx` — Shell, form state, dirty tracking, validation before save, left-side `Tabs` (`orientation="vertical"`), Guardrail Snapshot, and sticky save bar.
- `apps/web/src/app/dashboard/settings/playbook/_components/` — Small focused components for each tab panel (`guardrails-identity-panel.tsx`, `positioning-rules-panel.tsx`, `faq-objections-panel.tsx`, `icp-suppressions-panel.tsx`) plus a reusable `editable-string-list.tsx` helper.
- Verification: `bun run check`, `bun run check-types`, and `bun run test`.

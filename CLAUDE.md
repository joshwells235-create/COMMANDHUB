@AGENTS.md

# Command Hub — AI Chief of Staff

## Overview
Command Hub is an AI-powered Chief of Staff application built for Josh Wells / LeadShift. It manages the full scope of Josh's life across three contexts:
- **Practice** (client coaching work) — commitments, session prep, relationship health, follow-ups
- **LeadShift Internal** (business operations) — team coordination, product development, partner meetings
- **Personal** (life management) — fitness goals, family events, personal commitments, habit tracking

The system is designed around a single principle: **surface the right thing at the right time without Josh having to manage contexts manually.** No tabs, no workspace switching — one unified priority queue with intelligent context awareness.

**LeadShift is Josh's own business** — not a client. The system distinguishes LeadShift (internal) from client organizations via `is_own_business` flag. All AI prompts, filtering, nudges, and briefings are aware of this distinction.

## Who Josh Is (For AI Context)
Josh Wells is a Maverick PI profile — direct, independent, results-driven. Partner and top revenue producer at LeadShift (~$900K annual book across 60 clients). Father of two young boys, husband to Katelyn. He coaches leaders on being their best selves while trying to live that standard himself. His positioning archetype: "Wendy from Billions" — the trusted advisor who sees what others miss about leadership dynamics.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| React | v19 |
| Styling | Tailwind CSS v4 with CSS custom properties |
| Database | Supabase (PostgreSQL) |
| AI | Claude API via `@anthropic-ai/sdk` — model centralized in `src/lib/ai.ts` |
| Auth | Microsoft OAuth (via Supabase + Microsoft Graph) |
| Email | Resend (`src/lib/resend.ts`) |
| Drag & Drop | `@dnd-kit/core` + `@dnd-kit/sortable` |
| Toasts | `sonner` |
| Icons | `lucide-react` |
| Date utils | `date-fns` |
| Charts | Hand-rolled SVG (no charting library) |
| PDF parsing | `pdf-parse@1.1.1` (v1 API, dynamic require to avoid build-time test file issue) |

## Design System
- **Theme**: Jarvis-inspired dark HUD
- **Primary color**: Cyan `#06b6d4`
- **Background**: Deep navy `#0a0f1a`
- **Cards**: Glass morphism with `backdrop-filter: blur()` and semi-transparent backgrounds
- **Accent gradient**: Cyan → Indigo (`#06b6d4` → `#818cf8`)
- **Font**: Inter (sans), SF Mono (mono)
- **Status colors**: Danger `#f43f5e`, Warning `#f59e0b`, Success `#10b981`
- **Context colors**: Client = default (no badge), Internal = violet, Personal = emerald/green
- All CSS variables defined in `src/app/globals.css`
- Tailwind v4 `@theme inline` block maps CSS vars to Tailwind classes

## Three-Context System

### Categories
Commitments use `category` field: `'client' | 'internal' | 'personal'`
- **client**: Default. Anything linked to a non-LeadShift organization.
- **internal**: Tasks linked to LeadShift (is_own_business=true) or classified as internal by AI.
- **personal**: Fitness goals, family items, personal commitments. No org linked.

### How Categorization Works
- **Email extraction**: AI classifies email as `client/internal/vendor/newsletter/personal/scheduling`. Commitment category derived from this: internal→internal, personal→personal, else→client.
- **Quick Add**: Auto-infers from selected org. LeadShift org→internal, client org→client, no org→personal.
- **Calendar**: Personal events (Sleep, Deep Work, etc.) filtered by regex pre-filter before AI analysis. Only business event types generate commitments.
- **Display**: Internal items show violet badge, personal show green badge. Client items have no badge (they're the default).

### LeadShift Handling
- **NEVER auto-create contacts** under LeadShift from email extraction
- **NEVER link emails** to LeadShift unless AI classifies as genuinely `internal`
- **Filter LeadShift** out of client lists, nudges, health scores, follow-up queue, briefings (7+ endpoints use `is_own_business=false` filter)
- **Client detail page** shows "Internal Workspace" banner for LeadShift, hides Prep Mode/Briefing/Health Score/Intelligence Summary
- **Dashboard** separates LeadShift overdue from client overdue in Day Summary

## Database Tables (Supabase/PostgreSQL)

Key tables:
- **organizations** — Clients/orgs with status, strategic_value, industry, notes, `is_own_business`, `intelligence` (JSONB with revenue, tier, service types)
- **contacts** — People linked to organizations (role, email, `relationship_type` text[] array)
- **engagements** — Deals/contracts per org (type, status, value_amount, dates). 182 seeded from HubSpot.
- **commitments** — Core entity with `category` ('client'|'internal'|'personal'), priority scoring, snooze, escalation
- **commitment_activity** — Audit log for commitment changes
- **calendar_events** — Synced from Microsoft Graph, with `ai_analysis` JSON. Personal events filtered out of dashboard/briefings.
- **emails** — Synced from Microsoft Graph, with `ai_extraction` JSON. Needs-reply filters: excludes dismissed/accepted/reviewed, internal LeadShift, Josh's own copies.
- **transcripts** — Coaching session transcripts with AI-extracted fields
- **life_logs** — Personal life tracking (workouts, habits, family events, notes). Separate from commitments — no priority scoring needed.
- **assessments** — PDF assessment uploads
- **briefings** — Stored morning/weekly/evening briefing HTML
- **josh_profile** — Stores multiple profile types:
  - `business_context`: Revenue model, service portfolio, cross-sell patterns, quarterly targets, active priorities
  - `personal_goals`: Recurring goals (fitness 4x/week) and milestone goals (Language Leaks book)
  - `writing_style`, `coaching_voice`: Voice profile for draft generation
  - `coaching_methodology`: Extracted frameworks and patterns
  - `cross_client_patterns`, `theme_alerts`: Intelligence cache
  - `priority_patterns_insights`: AI-learned priority patterns

## Key Architectural Patterns

### Priority System
Commitments have `priority_score` (0-100) calculated by PostgreSQL function `calculate_priority_scores()` every 30 minutes via cron. Factors:
- **Base**: 40 points
- **Overdue**: +5 per day overdue, max +30
- **Due today/tomorrow/this week**: +15/+10/+5
- **Type bonus**: promise_made (+10), deliverable (+8), ask_received (+5), urgent prep (+15)
- **Strategic org**: +8 for strategic, +3 for emerging
- **Staleness**: +10 if untouched 10+ days, +5 if 5+ days
- **Calendar boost**: +20 if org has meeting today, +15 tomorrow, +10 in 3 days, +5 this week
- **AI modifier**: custom adjustment from `ai_priority_modifier`
- **Waiting items**: lower base (30), lighter scoring

Manual override via `manual_priority_override` and drag-and-drop reorder.

### Dashboard Architecture
The dashboard synthesizes, not dumps:
- **Day Summary banner**: Urgency badge + overdue breakdown by org (client vs internal vs personal) + "Right Now" guidance (meeting in X min with prep link, or highest-priority commitment) + momentum badge (completed today count) + quarterly revenue pace
- **Life Pulse strip**: Personal goal progress (fitness X/Y), milestone goals, personal items due soon. Shows zero-state prompt when no data.
- **Proactive Nudges**: 8 types scored 0-100: meeting_prep, going_cold, unreplied_emails, overdue_promise, stale_waiting, renewal_approaching, habit_reminder, personal_due. Personal nudges score higher in evenings/weekends.
- **Next Up Card**: Shows genuinely highest-priority commitment (now that scoring works — was broken with all-50 scores before fix)
- **Calendar**: Shows today + tomorrow with client context (overdue counts per org), personal events filtered out
- **Commitment rows**: Simplified — title + org + due context + type label. Context badges (Internal/Personal). One-click Done/Snooze on hover. Details/history in expanded view.
- **Intelligence section**: Collapsible — Follow-up Queue, Intelligence Panel (Health/Lifecycle/Insights), Client Pulse, Activity Feed

### Chatbot ("The Brain")
The Brain is the central interface for Josh's entire life. Key capabilities:
- **21+ action types**: create/update/complete/snooze/cancel commitments, manage orgs/contacts/engagements, generate drafts/briefings/prep, search transcripts/emails, log life events, set/update goals, update business context
- **Three-context awareness**: Separates CLIENT COMMITMENTS from INTERNAL LEADSHIFT TASKS in context. Includes personal goals, habit logs, and personal commitments.
- **Time awareness**: System prompt includes current Eastern Time. Adapts tone: morning (day ahead + personal), work hours (client focus), evening (lighter touch, personal check-in), weekend (personal priorities).
- **Personal life**: Logs workouts ("I worked out"), creates goals ("I want to run 3x/week"), tracks milestones ("Finished the outline"). Proactively mentions fitness gaps when relevant.
- **Strategic advisor**: Analyzes revenue trajectory, cross-sell opportunities, coaching concentration risks, pipeline gaps.
- **All dates in Eastern Time**: Calendar events, emails, logs all formatted in America/New_York timezone.

### Briefing System
Three briefing types:
- **Morning** (7am ET weekdays): Full-life briefing — The One Thing, Today's Schedule with prep teasers, Commitment Pulse, Who Needs Attention, Relationship Radar, Theme Alerts, **Your Life** (fitness, personal goals, family events), Pipeline Watch, Week Ahead, Replies Needed
- **Evening** (6pm ET weekdays): 150-200 word wind-down — what got done, tomorrow preview, fitness status, carry-forward overdue. Warm tone, designed to help close the laptop.
- **Weekly** (Monday morning): Practice scorecard, client health dashboard, wins, watch list, cross-client insight, **Personal Scorecard** (fitness, personal items, milestone goals), Revenue Pulse, renewals, next week outlook

### Email Processing
- **Sync**: Every 5 minutes via cron from Microsoft Graph (inbox + sent)
- **Turbo processing**: Every 10 minutes, processes 50 emails in parallel (5 concurrent AI extractions)
- **Intelligence extraction**: AI classifies email category, extracts commitments, detects needs_reply, identifies sentiment/topics/contacts
- **Auto-completion**: Sent emails auto-resolve matching commitments. Received emails resolve waiting_on items.
- **LeadShift guard**: Emails only linked to LeadShift if AI classifies as genuinely `internal`. Newsletters, vendor emails, Josh's own copies → org_id=null.
- **Needs-reply filters**: Excludes dismissed/accepted/reviewed, internal LeadShift, Josh's own sent copies, and emails where Josh already replied in the conversation thread.

### Calendar Processing
- **Sync**: Every 15 minutes from Microsoft Graph
- **Auto-analysis**: 5 events per cycle, prioritizing next 48 hours. Fills remaining slots with older events.
- **Personal filter**: Sleep, Deep Work, Workout, Lunch, etc. auto-classified as personal via regex — skips Claude analysis entirely.
- **Commitment guard**: Only business event types (coaching_session, workshop, pi_session, client_meeting, internal_leadshift, vistage) can generate commitments.
- **Deduplication**: Checks for similar existing commitments before creating calendar-sourced ones.
- **Dashboard display**: Personal events filtered from calendar API by default (unless `?include_personal=true`).

### Commitment Deduplication
**KNOWN ISSUE**: Current dedup uses simple substring matching on titles. This fails when the same task generates multiple commitments with different wordings from successive emails in a thread (e.g., "Reschedule meeting with Kathy" vs "Prepare for meeting with Kathy Piotte" vs "Attend PI renewal meeting with Kathy"). Needs semantic/entity-based dedup, not just string matching.

Current dedup logic:
- Before creating: fetch active commitments for same org
- Compare: `existingTitle === newTitle || existingTitle.includes(newTitle) || newTitle.includes(existingTitle)`
- Skip if match found

## Cron Jobs (vercel.json)

| Cron | Schedule | Purpose |
|------|----------|---------|
| sync-email | */5 * * * * | Sync + extract 15 emails per cycle |
| sync-calendar | */15 * * * * | Sync + analyze 5 events per cycle |
| process-emails | */10 * * * * | Turbo: 50 emails, 5 concurrent |
| recalculate-priority | */30 * * * * | Recalc all priority scores |
| wake-snoozed | 0 * * * * | Unsnooze past-due items |
| escalation | 0 12 * * * | Escalate overdue commitments |
| learn-priorities | 0 5 * * * | AI learns priority patterns |
| morning-briefing | 0 11 * * 1-5 | 7am ET weekday briefing |
| weekly-briefing | 0 11 * * 1 | Monday morning weekly review |
| evening-summary | 0 22 * * 1-5 | 6pm ET weekday wind-down |
| refresh-intelligence | 0 6 * * 0 | Sunday theme/cross-client refresh |

## Business Context (Seeded from HubSpot)
The database is seeded with Josh's full book of business:
- **60 organizations** with intelligence JSONB (revenue, tier, service types, relationship depth)
- **79 contacts** with roles and relationship types
- **182 engagements** ($1.63M closed + $221K pipeline) with service types and deal amounts
- **business_context** josh_profile with service portfolio, cross-sell patterns, quarterly targets ($225K), strategic insights, active priorities

## Common Gotchas
- **`is_processed` flag**: Transcripts must have `is_processed = true` to appear in prep, chat, and client detail queries.
- **Tailwind v4**: Uses `@theme inline` block, not `tailwind.config.js`. CSS variables map to Tailwind classes.
- **Next.js 16**: May have breaking changes from training data. Check `node_modules/next/dist/docs/` for current API docs.
- **No charting library**: All charts are hand-rolled SVG.
- **pdf-parse v1**: Must use `require('pdf-parse')` inside a function (not top-level import).
- **relationship_type is an array**: `contacts.relationship_type` is `text[]` not `text`.
- **is_own_business**: Always filter LeadShift out of client-facing queries. Use `orgs.filter(o => !o.is_own_business)`.
- **Category field**: `commitments.category` is `'client' | 'internal' | 'personal'` (was 'business' | 'personal', migrated).
- **Priority scoring**: The `calculate_priority_scores()` PostgreSQL function runs every 30 min. If scores seem wrong, trigger it manually via Supabase SQL.
- **Timezone**: All Brain context, briefings, and cron jobs use America/New_York (Eastern Time). Vercel runs in UTC — all date formatting must specify timezone.
- **LeadShift email guard**: Email extraction only links to LeadShift if `email_category === 'internal'`. This prevents newsletters, vendor emails, and Josh's own copies from being dumped into LeadShift.
- **Commitment dedup is weak**: Current string-matching dedup fails on semantically similar but differently-worded titles. This is a known issue that needs entity-based matching.

## Build & Run
```bash
npm run dev    # Development server
npm run build  # Production build
npm run lint   # ESLint
npx tsc --noEmit  # Type check
```

## Production
- **URL**: commandhub-tau.vercel.app
- **Dev branch**: claude/ai-chief-of-staff-lGXIb
- **Prod branch**: claude/ai-chief-of-staff-FOx8l
- **Supabase project**: ulvxewtapbfdpkgwtdiu

@AGENTS.md

# Command Hub — AI Chief of Staff

## Overview
Command Hub is an AI-powered Chief of Staff application built for Josh Wells / LeadShift. It manages client commitments, coaching session transcripts, calendar events, emails, and AI-generated briefings — all surfaced through a Jarvis-themed dark dashboard with an intelligent chatbot ("the Brain").

**LeadShift is Josh's own business** — not a client. The system distinguishes LeadShift (internal) from client organizations via `is_own_business` flag. All AI prompts are aware of this distinction.

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
- All CSS variables defined in `src/app/globals.css`
- Tailwind v4 `@theme inline` block maps CSS vars to Tailwind classes

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard (stats, commitments, calendar, pulse)
│   ├── layout.tsx                  # Root layout with Toaster, service worker
│   ├── globals.css                 # Jarvis theme CSS variables + base styles
│   ├── login/page.tsx              # Microsoft OAuth login
│   ├── analytics/page.tsx          # Analytics/scorecard (SVG charts)
│   ├── briefings/page.tsx          # Browse stored briefings (morning/weekly)
│   ├── clients/
│   │   ├── page.tsx                # Client list
│   │   └── [id]/page.tsx           # Client detail (commitments, transcripts, timeline, contacts, assessments)
│   ├── commitments/page.tsx        # Full commitments view (supports ?view=overdue|today|week|waiting)
│   ├── contacts/
│   │   ├── page.tsx                # People list with multi-tag relationship types
│   │   └── [id]/page.tsx           # Contact detail with assessments
│   ├── follow-ups/page.tsx         # Follow-up queue
│   ├── prep/[id]/page.tsx          # AI session prep for a calendar event
│   ├── review/page.tsx             # Email review inbox
│   ├── settings/page.tsx           # App settings
│   └── transcripts/
│       ├── page.tsx                # Transcript list
│       └── [id]/page.tsx           # Single transcript detail
│
│   ├── api/
│   │   ├── chat/route.ts           # AI chatbot (the "Brain") — deep data fetching, 14 action types
│   │   ├── prep/route.ts           # AI session prep generator
│   │   ├── search/route.ts         # Global search endpoint
│   │   ├── briefing/route.ts       # Generate a briefing on demand
│   │   ├── briefings/              # Stored briefings CRUD
│   │   │   ├── route.ts            #   GET list
│   │   │   └── [id]/route.ts       #   GET single briefing
│   │   ├── assessments/
│   │   │   ├── route.ts            #   GET assessments
│   │   │   ├── upload/route.ts     #   POST — PDF upload, text extraction, storage
│   │   │   └── [id]/route.ts       #   DELETE assessment
│   │   ├── commitments/
│   │   │   ├── route.ts            #   GET/POST commitments
│   │   │   └── [id]/
│   │   │       ├── route.ts        #   GET/PATCH/DELETE single commitment
│   │   │       ├── complete/route.ts
│   │   │       └── snooze/route.ts
│   │   ├── organizations/
│   │   │   ├── route.ts            #   GET/POST organizations
│   │   │   └── [id]/route.ts       #   GET/PATCH single org
│   │   ├── contacts/
│   │   │   ├── route.ts            #   GET/POST contacts
│   │   │   └── [id]/route.ts       #   PATCH/DELETE contact
│   │   ├── calendar/route.ts       # Calendar events
│   │   ├── emails/needs-reply/route.ts  # Needs-reply queue (filters Josh's own emails + tracks replies)
│   │   ├── transcripts/
│   │   │   ├── route.ts            #   GET/POST transcripts
│   │   │   ├── [id]/route.ts       #   GET single transcript
│   │   │   └── process/route.ts    #   POST — AI processes raw transcript → summary, themes, commitments
│   │   ├── activity/route.ts       # Commitment activity log
│   │   ├── review/
│   │   │   ├── route.ts            #   Email review queue
│   │   │   └── [id]/route.ts       #   Accept/dismiss review item
│   │   ├── stats/
│   │   │   ├── trends/route.ts     #   7-day sparkline data
│   │   │   └── weekly/route.ts     #   Weekly analytics (charts data)
│   │   ├── webhooks/transcript/route.ts  # External transcript webhook
│   │   ├── ai/
│   │   │   ├── analyze-calendar/route.ts
│   │   │   ├── cross-client/route.ts
│   │   │   ├── draft/route.ts      #   AI email/message draft generation
│   │   │   ├── extract-email/route.ts  # Email AI extraction + auto-completion (sent & received)
│   │   │   ├── follow-up-queue/route.ts
│   │   │   ├── lifecycle/route.ts
│   │   │   ├── longitudinal/route.ts
│   │   │   ├── methodology/route.ts
│   │   │   ├── relationship-health/route.ts
│   │   │   ├── theme-alerts/route.ts
│   │   │   └── voice-profile/route.ts
│   │   ├── cron/
│   │   │   ├── morning-briefing/route.ts   # Daily briefing email + store to DB
│   │   │   ├── weekly-briefing/route.ts    # Weekly briefing email + store to DB
│   │   │   ├── escalation/route.ts
│   │   │   ├── learn-priorities/route.ts
│   │   │   ├── recalculate-priority/route.ts
│   │   │   ├── sync-calendar/route.ts      # Microsoft Graph calendar sync
│   │   │   ├── sync-email/route.ts         # Microsoft Graph email sync
│   │   │   └── wake-snoozed/route.ts
│   │   ├── admin/bootstrap/route.ts  # Bootstrap josh_profile, requeue emails, org-match backfill
│   │   └── auth/                    # Microsoft OAuth flow
│
├── components/
│   ├── chat/command-hub-chat.tsx     # Floating chatbot — markdown, localStorage, copy, streaming
│   ├── calendar/today-events.tsx     # Today's events widget
│   ├── clients/interaction-timeline.tsx  # 90-day horizontal dot-map visualization
│   ├── commitments/
│   │   ├── commitment-list.tsx       # Sortable commitment list with drag-and-drop
│   │   ├── next-up-card.tsx          # "Next up" priority card
│   │   ├── quick-add.tsx             # Quick-add commitment form
│   │   └── waiting-on-list.tsx       # Waiting-on items list
│   ├── dashboard/
│   │   ├── activity-feed.tsx         # Recent activity feed
│   │   ├── client-pulse.tsx          # Client health overview
│   │   ├── follow-up-widget.tsx      # Follow-up reminders
│   │   ├── intelligence-panel.tsx    # AI intelligence panel
│   │   ├── lifecycle-tracker.tsx     # Client lifecycle stages
│   │   ├── practice-intelligence.tsx # Cross-client practice insights
│   │   ├── proactive-nudges.tsx      # Proactive intelligence nudges
│   │   ├── relationship-health.tsx   # Relationship health scores
│   │   └── theme-alerts.tsx          # Cross-client theme detection
│   ├── drafts/draft-composer.tsx     # AI draft composition UI
│   ├── organizations/quick-add-org.tsx
│   ├── review/
│   │   ├── email-review-card.tsx     # Individual email review card
│   │   └── needs-reply-section.tsx   # Needs-reply queue
│   └── ui/
│       ├── command-palette.tsx        # Cmd+K command palette with fuzzy search
│       ├── keyboard-shortcuts.tsx     # Global keyboard shortcuts (G-prefix nav, ?, etc.)
│       ├── snooze-picker.tsx          # Snooze date picker
│       └── sparkline.tsx              # SVG sparkline component
│
├── lib/
│   ├── ai.ts                         # Centralized AI model config (claude-sonnet-4-20250514)
│   ├── auth.ts                        # Auth utilities
│   ├── auto-detect-org.ts            # Org auto-detection from text
│   ├── embeddings.ts                  # Embedding utilities
│   ├── match-org.ts                   # Shared fuzzy org-matching utility (domain-based)
│   ├── microsoft-graph.ts            # Microsoft Graph API client
│   ├── resend.ts                      # Resend email client
│   ├── utils.ts                       # Shared utilities (cn, etc.)
│   ├── supabase/
│   │   ├── client.ts                  # Browser Supabase client
│   │   └── server.ts                  # Server Supabase client
│   └── hooks/
│       ├── use-calendar.ts
│       ├── use-client-detail.ts
│       ├── use-commitments.ts
│       ├── use-needs-reply.ts
│       ├── use-organizations.ts
│       └── use-review-queue.ts
│
├── types/database.ts                  # All TypeScript types (Organization, Commitment, etc.)
└── middleware.ts                       # Auth middleware

supabase/
├── schema.sql                         # Full database schema
├── seed.sql                           # Seed data
├── migrate-briefings.sql              # Briefings table migration
├── migrate-missing-columns.sql        # Column backfill migration
└── fix-is-processed.sql               # Backfill is_processed=true for processed transcripts
```

## Database Tables (Supabase/PostgreSQL)

Key tables and their purposes:
- **organizations** — Clients/orgs with status, strategic_value, industry, notes, `is_own_business` (boolean, true for LeadShift)
- **contacts** — People linked to organizations (role, email, `relationship_type` is `text[]` array — supports multiple tags like champion, coachee, partner, friend)
- **engagements** — Business engagements/contracts per org (type, status, value, dates)
- **commitments** — Core entity: tasks/promises/follow-ups with priority scoring, snooze, escalation
- **commitment_activity** — Audit log for commitment changes (created, completed, escalated, etc.)
- **calendar_events** — Synced from Microsoft Graph, with `ai_analysis` JSON (prep_notes, event_type, implied_commitments)
- **emails** — Synced from Microsoft Graph, with `ai_extraction` JSON (commitments, needs_reply, summary, resolved_commitment_ids)
- **transcripts** — Coaching session transcripts with AI-extracted fields:
  - `summary`, `themes`, `language_leaks`, `breakthroughs`, `growth_areas`
  - `session_arc`, `notable_quotes`, `recommended_focus_next_session`
  - `is_processed` flag (gates visibility to prep/chat/dashboard)
  - `org_id` links to client
- **assessments** — PDF assessment uploads (PI, EQ-i 2.0, DiSC, MBTI, etc.) with file_url, raw_text, ai_analysis
- **briefings** — Stored morning/weekly briefing HTML for browsing in-app
- **josh_profile** — Voice profile, coaching methodology, writing style, theme alerts, priority patterns

## Key Architectural Patterns

### AI Model Configuration
All AI calls use the centralized model from `src/lib/ai.ts`:
```ts
export const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
```
Change it once, applies everywhere.

### Own Business vs Clients
Organizations with `is_own_business = true` (LeadShift) are treated differently across all AI prompts:
- Email extraction categorizes LeadShift emails as "internal" not "client"
- Calendar analysis classifies LeadShift meetings as "internal_leadshift"
- Chat/Brain lists LeadShift separately from the client list
- Briefings separate internal business from client-facing work
- LeadShift team members (Brian Burlas, Dan Guglielmo, Steve Cundall, etc.) are colleagues, not clients

### Commitment System
**Creation**: Commitments are extracted from 3 sources — emails, transcripts, and calendar events. All prompts enforce a strict quality bar:
- Only SPECIFIC, CONCRETE action items with a clear responsible party
- Skip vague intentions, generic coaching homework, scheduling, FYI items, recurring routines
- Aim for 0-3 per email, 0-4 per transcript, 0 for most calendar events

**Ownership**: `owner=josh` (Josh's action), `owner=other` with `commitment_type=waiting_on` (tracking others' promises)

**Auto-completion**: Commitments auto-resolve from 3 sources:
- Sent emails: Josh's sent email matches a pending commitment → marked complete
- Received emails: incoming email shows someone delivered on a `waiting_on` item → marked complete
- Transcripts: pending commitments for an org included in AI context, resolved items auto-completed

**Deduplication**: Before creating a commitment, checks for existing active commitments with similar/matching titles for the same org. Prevents cross-source duplicates.

**Types**: promise_made, ask_received, follow_up, waiting_on, deliverable, prep, internal, note_to_self
**Statuses**: pending, in_progress, snoozed, waiting, completed, cancelled

### Dashboard Stat Cards
The Overdue, Due Today, This Week, and Waiting On stat cards are clickable links that navigate to `/commitments?view=overdue|today|week|waiting` with the appropriate filter pre-applied.

### Needs-Reply Logic
`/api/emails/needs-reply` filters out:
1. Emails where sender is Josh (inbox copies of sent mail)
2. Emails where Josh already replied in the same conversation thread (uses `conversation_id` to track)

### Chatbot ("The Brain") — `src/app/api/chat/route.ts`
The chatbot is the central intelligence hub. Key behaviors:
- **Auto-detects mentioned orgs** via `detectMentionedOrgs()` — matches against real org list (abbreviations, partial, case-insensitive)
- **Deep client auto-fetch** when org mentioned: all commitments (30), transcripts with full insights (10), contacts, calendar events, health metrics
- **Always fetches** recent transcript summaries (8), emails (15), engagements, briefing history (3), calendar with ai_analysis, full josh_profile
- **14 action types** via structured JSON: create/update/complete/snooze commitments, draft emails/messages, create/update contacts, create/update orgs, search, navigate
- **max_tokens**: 4096 (main chat, draft generation, briefing generation)
- **History**: last 20 messages sent to API, 50 stored in localStorage

### Transcript Processing — `src/app/api/transcripts/process/route.ts`
When a transcript is processed:
1. AI extracts: summary, themes, language_leaks, breakthroughs, growth_areas, session_arc, notable_quotes, recommended_focus, commitments, resolved_commitment_ids
2. Sets `is_processed = true` (critical — gates all downstream queries)
3. Auto-resolves any pending commitments identified as addressed in the session
4. Creates new commitment records (with deduplication check)
5. Logs `commitment_activity` for each created/resolved commitment
6. Updates org `updated_at` timestamp
7. Updates engagement session count and notes
8. Session-over-session comparison against last 3 transcripts for same org

### Session Prep — `src/app/api/prep/route.ts`
- Fetches last 3 transcripts (multi-session history)
- Includes language leaks, breakthroughs, growth areas, notable quotes
- Builds rich AI prompt referencing specific themes/quotes
- Outputs `thread_to_pull` for conversation starters
- max_tokens: 1024

### Priority System
Commitments have `priority_score` (0-100) calculated by cron. Factors: due date proximity, escalation_level, strategic_value of org, ai_priority_modifier. Manual override via `manual_priority_override`. Drag-and-drop reorder updates priority_score.

### Keyboard Shortcuts — `src/components/ui/keyboard-shortcuts.tsx`
- `G` prefix navigation: G+H (home), G+C (clients), G+T (transcripts), G+M (commitments), G+F (follow-ups), G+A (analytics), G+B (briefings), G+S (settings)
- `N` — new commitment
- `/` — focus chat
- `?` — help overlay
- `Cmd+K` — command palette
- Skips when focus is in inputs. 1.5s timeout for G-prefix.

### Command Palette — `src/components/ui/command-palette.tsx`
Cmd+K opens fuzzy-search palette with navigation entries for all pages.

## Data Flow

```
Microsoft Graph ──sync──→ calendar_events ──analyze──→ ai_analysis (prep_notes, commitments)
                ──sync──→ emails ──extract──→ ai_extraction (commitments, needs_reply, resolved_commitment_ids)
                                            → auto-complete matching commitments (sent & received)
                                            → dedup check before creating new commitments

Transcript Upload ──process──→ summary, themes, quotes, commitments
                              → auto-resolve pending commitments discussed in session
                              → dedup check before creating new commitments
                              → commitment_activity log
                              → org updated_at refresh
                              → engagement session count update
                              → session comparison vs prior 3 sessions

Assessment Upload ──extract──→ PDF text extraction via pdf-parse
                             → Supabase Storage (assessments bucket)
                             → AI analysis (strengths, development areas, coaching implications)

Cron Jobs:
  morning-briefing → email + store in briefings table
  weekly-briefing  → email + store in briefings table
  escalation       → bump escalation_level on overdue commitments
  recalculate-priority → recalc all commitment priority_scores
  learn-priorities → update josh_profile priority patterns
  wake-snoozed     → unsnoze commitments past snoozed_until
```

## Environment Variables
Required env vars (set in Supabase/Vercel):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
- `AI_MODEL` (optional, defaults to `claude-sonnet-4-20250514`)

## Development Notes

### Common Gotchas
- **`is_processed` flag**: Transcripts must have `is_processed = true` to appear in prep, chat, and client detail queries. If transcripts seem invisible, check this flag.
- **Tailwind v4**: Uses `@theme inline` block, not `tailwind.config.js`. CSS variables map to Tailwind classes.
- **Next.js 16**: May have breaking changes from training data. Check `node_modules/next/dist/docs/` for current API docs.
- **No charting library**: All charts (sparklines, bar charts, donut charts, line charts) are hand-rolled SVG in components.
- **Toast notifications**: Use `toast.success()` / `toast.error()` from `sonner`.
- **pdf-parse v1**: Must use `require('pdf-parse')` inside a function (not top-level import) to avoid build-time test file loading error.
- **relationship_type is an array**: `contacts.relationship_type` is `text[]` not `text`. Use array operations (`.includes()`, spread, etc.) not string comparisons.
- **is_own_business**: Always filter LeadShift out of client lists in AI prompts. Use `orgs.filter(o => !o.is_own_business)` for client-facing contexts.
- **Commitment quality**: AI prompts enforce strict criteria — only specific, concrete action items. Do NOT create commitments for meeting attendance, vague intentions, recurring routines (sleep, deep work, exercise), or FYI items.

### Build & Run
```bash
npm run dev    # Development server
npm run build  # Production build
npm run lint   # ESLint
npx tsc --noEmit  # Type check
```

### Pending Migrations
Run these against Supabase if not already applied:
- `supabase/migrate-briefings.sql` — Creates briefings table
- `supabase/fix-is-processed.sql` — Backfills is_processed=true for already-processed transcripts

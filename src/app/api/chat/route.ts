import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getBusinessContext, formatBusinessContextForPrompt, formatOrgRevenueForPrompt } from '@/lib/business-context';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ActionData {
  type: string;
  data: Record<string, unknown>;
}

interface ActionResult {
  type: string;
  success: boolean;
  details: string;
}

interface StructuredResponse {
  message: string;
  actions?: ActionData[];
}

// ---------------------------------------------------------------------------
// Intent & keyword detection
// ---------------------------------------------------------------------------

function needsRAG(message: string): boolean {
  const ragKeywords = ['session', 'said', 'discussed', 'theme', 'transcript', 'mentioned', 'talked about', 'conversation', 'coaching', 'worried', 'concerned', 'going on', 'happening', 'issues', 'problems', 'email', 'emailed', 'wrote', 'sent', 'replied', 'message', 'commitment', 'promised', 'overdue', 'waiting'];
  const lower = message.toLowerCase();
  return ragKeywords.some((kw) => lower.includes(kw));
}

/**
 * Match mentioned org names against the actual org list. Handles abbreviations,
 * partial matches, and case-insensitive matching.
 */
function detectMentionedOrgs(
  message: string,
  orgs: Array<{ id: string; name: string }>
): Array<{ id: string; name: string }> {
  const lower = message.toLowerCase();
  const matched: Array<{ id: string; name: string }> = [];

  for (const org of orgs) {
    const orgLower = org.name.toLowerCase();
    // Exact or substring match
    if (lower.includes(orgLower)) {
      matched.push(org);
      continue;
    }
    // Match abbreviation-style names (e.g. "MMG" matches "MMG Insurance")
    const orgWords = orgLower.split(/\s+/);
    for (const word of orgWords) {
      if (word.length >= 3 && lower.includes(word)) {
        matched.push(org);
        break;
      }
    }
    // Also check if the org name IS an abbreviation (all caps, 2+ chars)
    if (org.name.length >= 2 && org.name === org.name.toUpperCase()) {
      if (lower.includes(org.name.toLowerCase())) {
        if (!matched.find((m) => m.id === org.id)) matched.push(org);
      }
    }
  }

  return matched;
}

function detectIntent(message: string): {
  fetchClients: boolean;
  fetchCalendar: boolean;
  fetchCommitments: boolean;
  isDraft: boolean;
  isAction: boolean;
  clientName: string | null;
} {
  const lower = message.toLowerCase();

  const isDraft = lower.includes('draft') || lower.includes('write') || lower.includes('email');
  const fetchCalendar =
    lower.includes('schedule') ||
    lower.includes('calendar') ||
    lower.includes('week') ||
    lower.includes('today') ||
    lower.includes('upcoming');
  const fetchClients =
    lower.includes('client') ||
    lower.includes('org') ||
    lower.includes('company');
  const fetchCommitments =
    lower.includes('overdue') ||
    lower.includes('priorities') ||
    lower.includes('priority') ||
    lower.includes("what's next") ||
    lower.includes('what should') ||
    lower.includes('forgetting') ||
    lower.includes('forget') ||
    lower.includes('commitments') ||
    lower.includes('to do') ||
    lower.includes('todo') ||
    lower.includes('personal');

  // Action intent keywords
  const actionKeywords = [
    'create', 'add', 'snooze', 'complete', 'done', 'finish',
    'draft', 'write', 'email', 'brief', 'prep', 'mark',
    'remind', 'schedule', 'set', 'make',
  ];
  const isAction = actionKeywords.some((kw) => lower.includes(kw));

  // Client name extraction left for backwards compat — real matching uses detectMentionedOrgs
  let clientName: string | null = null;
  const withMatch = lower.match(/(?:with|for|about|at)\s+([a-z][\w\s]*?)(?:\?|$|\.|\s+(?:and|or|but))/i);
  if (withMatch) {
    clientName = withMatch[1].trim();
  }

  return { fetchClients, fetchCalendar, fetchCommitments, isDraft, isAction, clientName };
}

// ---------------------------------------------------------------------------
// Date parsing helpers
// ---------------------------------------------------------------------------

function parseRelativeDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const lower = dateStr.toLowerCase().trim();
  const now = new Date();

  if (lower === 'today') {
    return now.toISOString().split('T')[0];
  }
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  if (lower === 'next week') {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  }

  // "in N days"
  const inDaysMatch = lower.match(/in\s+(\d+)\s+days?/);
  if (inDaysMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
    return d.toISOString().split('T')[0];
  }

  // "in N weeks"
  const inWeeksMatch = lower.match(/in\s+(\d+)\s+weeks?/);
  if (inWeeksMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(inWeeksMatch[1], 10) * 7);
    return d.toISOString().split('T')[0];
  }

  // Day of week (next occurrence)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = dayNames.indexOf(lower);
  if (dayIndex !== -1) {
    const d = new Date(now);
    const currentDay = d.getDay();
    let daysAhead = dayIndex - currentDay;
    if (daysAhead <= 0) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().split('T')[0];
  }

  // Try ISO date or other parseable formats
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Relationship health & follow-up urgency helpers
// ---------------------------------------------------------------------------

function scoreContactRecency(days: number): number {
  if (days <= 7) return 25;
  if (days <= 14) return 20;
  if (days <= 21) return 15;
  if (days <= 30) return 10;
  return 0;
}

function scoreOverdueHealth(count: number): number {
  if (count === 0) return 25;
  if (count === 1) return 20;
  if (count === 2) return 15;
  return 5;
}

function scoreFrequency(avgDays: number | null): number {
  if (avgDays === null) return 5;
  if (avgDays <= 10) return 25;
  if (avgDays <= 18) return 20;
  if (avgDays <= 35) return 15;
  return 5;
}

function healthStatusLabel(score: number): string {
  if (score >= 80) return 'thriving';
  if (score >= 60) return 'healthy';
  if (score >= 40) return 'cooling';
  return 'at_risk';
}

function followUpUrgency(overdueCount: number, daysSinceContact: number, waitingCount: number, strategicValue: string): number {
  let score = 0;
  score += Math.min(overdueCount * 30, 60);
  if (daysSinceContact >= 30) score += 40;
  else if (daysSinceContact >= 21) score += 25;
  else if (daysSinceContact >= 14) score += 15;
  score += Math.min(waitingCount * 20, 40);
  const multipliers: Record<string, number> = { strategic: 1.3, standard: 1.0, emerging: 0.8 };
  score = Math.round(score * (multipliers[strategicValue] || 1.0));
  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

async function executeActions(
  actions: ActionData[],
  supabase: ReturnType<typeof createServerClient>,
  allOrgs: Array<{ id: string; name: string }>,
  baseUrl: string,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'create_commitment': {
          const d = action.data as {
            title?: string;
            org_id?: string;
            org_name?: string;
            commitment_type?: string;
            due_date?: string;
            owner?: string;
            description?: string;
          };

          if (!d.title) {
            results.push({ type: action.type, success: false, details: 'Missing title for commitment' });
            break;
          }

          // Resolve org_id from org_name if needed
          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find(
              (o) => o.name.toLowerCase() === d.org_name!.toLowerCase()
            );
            if (match) orgId = match.id;
          }

          const commitmentType = d.commitment_type || 'follow_up';
          const dueDate = d.due_date ? parseRelativeDate(d.due_date) || d.due_date : null;
          const now = new Date().toISOString();

          const { data: commitment, error } = await supabase
            .from('commitments')
            .insert({
              title: d.title,
              description: d.description ?? null,
              commitment_type: commitmentType,
              org_id: orgId,
              owner: d.owner ?? 'josh',
              due_date: dueDate,
              status: 'pending',
              priority_score: 0,
              escalation_level: 0,
              ai_priority_modifier: 0,
              last_touched_at: now,
            })
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            // Log activity
            await supabase.from('commitment_activity').insert({
              commitment_id: commitment.id,
              action: 'created',
              details: { title: commitment.title, source: 'chat' },
            });
            results.push({
              type: action.type,
              success: true,
              details: `Created '${d.title}'${dueDate ? ' due ' + dueDate : ''}`,
            });
          }
          break;
        }

        case 'complete_commitment': {
          const d = action.data as { id?: string; title?: string };
          let commitmentId = d.id;

          // If no ID but title provided, try to find by title
          if (!commitmentId && d.title) {
            const { data: found } = await supabase
              .from('commitments')
              .select('id, title')
              .ilike('title', `%${d.title}%`)
              .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
              .limit(1)
              .single();
            if (found) commitmentId = found.id;
          }

          if (!commitmentId) {
            results.push({ type: action.type, success: false, details: 'Could not identify commitment to complete' });
            break;
          }

          const now = new Date().toISOString();
          const { data, error } = await supabase
            .from('commitments')
            .update({
              status: 'completed',
              completed_at: now,
              last_touched_at: now,
              updated_at: now,
            })
            .eq('id', commitmentId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            await supabase.from('commitment_activity').insert({
              commitment_id: commitmentId,
              action: 'completed',
              details: { completed_at: now, source: 'chat' },
            });
            results.push({
              type: action.type,
              success: true,
              details: `Completed '${data.title}'`,
            });
          }
          break;
        }

        case 'snooze_commitment': {
          const d = action.data as { id?: string; title?: string; until?: string };
          let commitmentId = d.id;

          if (!commitmentId && d.title) {
            const { data: found } = await supabase
              .from('commitments')
              .select('id, title')
              .ilike('title', `%${d.title}%`)
              .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
              .limit(1)
              .single();
            if (found) commitmentId = found.id;
          }

          if (!commitmentId) {
            results.push({ type: action.type, success: false, details: 'Could not identify commitment to snooze' });
            break;
          }

          const snoozedUntil = d.until ? (parseRelativeDate(d.until) || d.until) : null;
          if (!snoozedUntil) {
            results.push({ type: action.type, success: false, details: 'Missing snooze date' });
            break;
          }

          const now = new Date().toISOString();
          const { data, error } = await supabase
            .from('commitments')
            .update({
              status: 'snoozed',
              snoozed_until: snoozedUntil,
              last_touched_at: now,
              updated_at: now,
            })
            .eq('id', commitmentId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            await supabase.from('commitment_activity').insert({
              commitment_id: commitmentId,
              action: 'snoozed',
              details: { snoozed_until: snoozedUntil, source: 'chat' },
            });
            results.push({
              type: action.type,
              success: true,
              details: `Snoozed '${data.title}' until ${snoozedUntil}`,
            });
          }
          break;
        }

        case 'generate_draft': {
          const d = action.data as {
            org_id?: string;
            org_name?: string;
            draft_type?: string;
            context?: string;
          };

          // Resolve org_id from org_name if needed
          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find(
              (o) => o.name.toLowerCase() === d.org_name!.toLowerCase()
            );
            if (match) orgId = match.id;
          }

          const draftType = d.draft_type || 'general';
          const draftContext = d.context || 'General communication';

          // Fetch Josh's voice profile
          const { data: profileRows } = await supabase
            .from('josh_profile')
            .select('profile_type, profile_data');

          const profileMap: Record<string, unknown> = {};
          for (const row of profileRows || []) {
            profileMap[row.profile_type] = row.profile_data;
          }

          const writingStyle = profileMap['writing_style']
            ? JSON.stringify(profileMap['writing_style'], null, 2)
            : 'No writing style profile available yet. Use a professional, warm, and direct tone.';
          const coachingVoice = profileMap['coaching_voice']
            ? JSON.stringify(profileMap['coaching_voice'], null, 2)
            : "No coaching voice profile available yet. Use an insightful, direct consulting approach.";

          // Fetch org context if available
          let orgContext = '';
          if (orgId) {
            const { data: org } = await supabase
              .from('organizations')
              .select('name, industry, status, strategic_value, notes')
              .eq('id', orgId)
              .single();

            if (org) {
              const { data: recentTranscripts } = await supabase
                .from('transcripts')
                .select('title, summary, transcript_date')
                .eq('org_id', orgId)
                .eq('is_processed', true)
                .order('transcript_date', { ascending: false })
                .limit(3);

              const { data: openCommitments } = await supabase
                .from('commitments')
                .select('title, commitment_type, due_date, status, owner')
                .eq('org_id', orgId)
                .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
                .order('priority_score', { ascending: false })
                .limit(10);

              const transcriptSummaries = (recentTranscripts || [])
                .map((t) => `- ${t.title} (${t.transcript_date}): ${t.summary || 'No summary'}`)
                .join('\n');

              const commitmentsList = (openCommitments || [])
                .map((c) => `- [${c.commitment_type}] ${c.title} (${c.status}, due: ${c.due_date || 'no date'}, owner: ${c.owner})`)
                .join('\n');

              orgContext = `\nRecent relationship context for ${org.name} (${org.industry || 'unknown industry'}, ${org.strategic_value} client, ${org.status}):\n${org.notes ? `Notes: ${org.notes}` : ''}\nRecent sessions:\n${transcriptSummaries || 'No recent sessions'}\nOpen commitments:\n${commitmentsList || 'No open commitments'}`;
            }
          }

          const client = new Anthropic();
          const draftResponse = await client.messages.create({
            model: AI_MODEL,
            max_tokens: 4096,
            messages: [
              {
                role: 'user',
                content: `You are drafting content for Josh Wells, Partner at LeadShift.
Write in Josh's voice using this profile:

Writing Style: ${writingStyle}
Coaching Voice: ${coachingVoice}

Draft type: ${draftType}
Context: ${draftContext}
${orgContext}

Generate the draft. Match Josh's tone, vocabulary, and style exactly.
Keep it concise and actionable. Do not include placeholder brackets or instructions - write the actual content as Josh would.`,
              },
            ],
          });

          const textContent = draftResponse.content.find((c) => c.type === 'text');
          if (textContent && textContent.type === 'text') {
            results.push({
              type: action.type,
              success: true,
              details: textContent.text,
            });
          } else {
            results.push({ type: action.type, success: false, details: 'Failed to generate draft' });
          }
          break;
        }

        case 'generate_briefing': {
          const d = action.data as { org_id?: string; org_name?: string };

          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find(
              (o) => o.name.toLowerCase() === d.org_name!.toLowerCase()
            );
            if (match) orgId = match.id;
          }

          if (!orgId) {
            results.push({ type: action.type, success: false, details: 'Could not determine organization for briefing' });
            break;
          }

          const { data: org } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', orgId)
            .single();

          if (!org) {
            results.push({ type: action.type, success: false, details: 'Organization not found' });
            break;
          }

          const { data: contacts } = await supabase
            .from('contacts')
            .select('name, role, relationship_type')
            .eq('org_id', orgId);

          const { data: recentTranscripts } = await supabase
            .from('transcripts')
            .select('*')
            .eq('org_id', orgId)
            .eq('is_processed', true)
            .order('transcript_date', { ascending: false })
            .limit(3);

          const { data: openCommitments } = await supabase
            .from('commitments')
            .select('title, commitment_type, owner, due_date, status')
            .eq('org_id', orgId)
            .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
            .order('priority_score', { ascending: false });

          const lastTranscript = recentTranscripts?.[0] || null;
          const contactNames = (contacts || []).map((c) => c.name).join(', ') || 'Unknown';

          const aggregatedThemes = (recentTranscripts || [])
            .flatMap((t) => t.key_themes || [])
            .filter((theme: string, index: number, arr: string[]) => arr.indexOf(theme) === index);

          const languageLeaks = (recentTranscripts || [])
            .flatMap((t) => t.language_leaks_observed || [])
            .filter((leak: string, index: number, arr: string[]) => arr.indexOf(leak) === index);

          const commitmentsList = (openCommitments || [])
            .map(
              (c) =>
                `- [${c.owner === 'josh' ? 'Josh' : 'Client'}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''})`
            )
            .join('\n') || 'None';

          const prompt = `Generate a pre-session briefing for Josh's upcoming session.

Client: ${contactNames} (${org.name})
Industry: ${org.industry || 'Not specified'}
Strategic value: ${org.strategic_value}
Engagement status: ${org.status}

${
  lastTranscript
    ? `Last session summary: ${lastTranscript.summary || 'No summary available'}
Last session date: ${lastTranscript.transcript_date}
Recommended focus from last session: ${lastTranscript.recommended_focus_next_session || 'None specified'}`
    : 'No previous sessions recorded.'
}

Open commitments for this client:
${commitmentsList}

Key themes from recent sessions: ${aggregatedThemes.length > 0 ? aggregatedThemes.join(', ') : 'None recorded'}

Language leaks observed recently: ${languageLeaks.length > 0 ? languageLeaks.join('; ') : 'None recorded'}

Generate a concise briefing:
1. Where you left off last time (2-3 sentences)
2. Open items to address (commitments from either side)
3. Themes to potentially revisit or deepen
4. One provocative question Josh might consider asking

Return as plain text, formatted for quick reading. Use short paragraphs and bullet points.`;

          const client = new Anthropic();
          const briefingResponse = await client.messages.create({
            model: AI_MODEL,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          });

          const textContent = briefingResponse.content.find((c) => c.type === 'text');
          if (textContent && textContent.type === 'text') {
            results.push({
              type: action.type,
              success: true,
              details: textContent.text,
            });
          } else {
            results.push({ type: action.type, success: false, details: 'Failed to generate briefing' });
          }
          break;
        }

        case 'search_transcripts': {
          const d = action.data as { query?: string };
          if (!d.query) {
            results.push({ type: action.type, success: false, details: 'Missing search query' });
            break;
          }

          const searchWords = d.query
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter((w) => w.length > 3)
            .slice(0, 5)
            .join(' | ');

          const { data: chunks } = await supabase
            .from('transcript_chunks')
            .select('content, metadata, transcript_id, transcripts(title, transcript_date, organizations(name))')
            .textSearch('content', searchWords, { type: 'websearch', config: 'english' })
            .limit(5);

          if (chunks && chunks.length > 0) {
            const snippets = chunks.map((c: Record<string, unknown>) => {
              const transcripts = c.transcripts as Record<string, unknown>[] | Record<string, unknown> | null;
              const t = Array.isArray(transcripts) ? transcripts[0] : transcripts;
              const orgs = t?.organizations as Record<string, unknown>[] | null;
              return `[${t?.title || 'Unknown'}, ${t?.transcript_date || 'Unknown'}, ${orgs?.[0]?.name || 'Unknown'}]: ${(c.content as string).substring(0, 300)}`;
            });
            results.push({
              type: action.type,
              success: true,
              details: snippets.join('\n\n'),
            });
          } else {
            results.push({
              type: action.type,
              success: true,
              details: 'No transcript matches found for that query.',
            });
          }
          break;
        }

        case 'search_emails': {
          const d = action.data as { query?: string; org_name?: string };
          if (!d.query) {
            results.push({ type: action.type, success: false, details: 'Missing search query' });
            break;
          }

          let orgIdFilter: string | null = null;
          if (d.org_name) {
            const matchedOrg = allOrgs.find(
              (o) => o.name.toLowerCase() === d.org_name!.toLowerCase()
            );
            if (matchedOrg) orgIdFilter = matchedOrg.id;
          }

          let query = supabase
            .from('emails')
            .select('subject, sender, sender_email, body_preview, received_at, folder, ai_extraction')
            .eq('is_processed', true)
            .ilike('subject', `%${d.query}%`)
            .order('received_at', { ascending: false })
            .limit(10);

          if (orgIdFilter) {
            query = query.eq('org_id', orgIdFilter);
          }

          const { data: emailResults } = await query;

          if (emailResults && emailResults.length > 0) {
            const snippets = emailResults.map((e) => {
              const extraction = e.ai_extraction as Record<string, unknown> | null;
              const dir = e.folder === 'sent' ? 'SENT' : 'RECEIVED';
              return `[${dir}] ${e.subject} — ${e.sender} (${e.received_at?.split('T')[0] || 'unknown'})
  ${e.body_preview?.substring(0, 200) || 'No preview'}${extraction?.email_summary ? `\n  Summary: ${extraction.email_summary}` : ''}`;
            });
            results.push({
              type: action.type,
              success: true,
              details: snippets.join('\n\n'),
            });
          } else {
            results.push({
              type: action.type,
              success: true,
              details: 'No email matches found for that query.',
            });
          }
          break;
        }

        case 'update_commitment': {
          const d = action.data as { id?: string; title?: string; updates?: Record<string, unknown> };
          let commitmentId = d.id;

          if (!commitmentId && d.title) {
            const { data: found } = await supabase
              .from('commitments')
              .select('id, title')
              .ilike('title', `%${d.title}%`)
              .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
              .limit(1)
              .single();
            if (found) commitmentId = found.id;
          }

          if (!commitmentId) {
            results.push({ type: action.type, success: false, details: 'Could not identify commitment to update' });
            break;
          }

          const updates = d.updates || {};
          if (updates.due_date && typeof updates.due_date === 'string') {
            updates.due_date = parseRelativeDate(updates.due_date) || updates.due_date;
          }

          // Resolve org_name to org_id (commitments table uses org_id, not org_name)
          if (updates.org_name && typeof updates.org_name === 'string') {
            const match = allOrgs.find(
              (o) => o.name.toLowerCase() === (updates.org_name as string).toLowerCase()
            );
            if (match) updates.org_id = match.id;
            delete updates.org_name;
          }

          const now = new Date().toISOString();
          const { data, error } = await supabase
            .from('commitments')
            .update({ ...updates, last_touched_at: now, updated_at: now })
            .eq('id', commitmentId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            await supabase.from('commitment_activity').insert({
              commitment_id: commitmentId,
              action: 'updated',
              details: { updates, source: 'chat' },
            });
            results.push({ type: action.type, success: true, details: `Updated '${data.title}'` });
          }
          break;
        }

        case 'cancel_commitment': {
          const d = action.data as { id?: string; title?: string };
          let commitmentId = d.id;

          if (!commitmentId && d.title) {
            const { data: found } = await supabase
              .from('commitments')
              .select('id, title')
              .ilike('title', `%${d.title}%`)
              .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
              .limit(1)
              .single();
            if (found) commitmentId = found.id;
          }

          if (!commitmentId) {
            results.push({ type: action.type, success: false, details: 'Could not identify commitment to cancel' });
            break;
          }

          const now = new Date().toISOString();
          const { data, error } = await supabase
            .from('commitments')
            .update({ status: 'cancelled', updated_at: now, last_touched_at: now })
            .eq('id', commitmentId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            await supabase.from('commitment_activity').insert({
              commitment_id: commitmentId,
              action: 'cancelled',
              details: { cancelled_at: now, source: 'chat' },
            });
            results.push({ type: action.type, success: true, details: `Cancelled '${data.title}'` });
          }
          break;
        }

        case 'update_organization': {
          const d = action.data as { id?: string; name?: string; updates?: Record<string, unknown> };
          let orgId = d.id;

          if (!orgId && d.name) {
            const match = allOrgs.find((o) => o.name.toLowerCase() === d.name!.toLowerCase());
            if (match) orgId = match.id;
          }

          if (!orgId) {
            results.push({ type: action.type, success: false, details: 'Could not identify organization' });
            break;
          }

          const updates = d.updates || {};
          const { data, error } = await supabase
            .from('organizations')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', orgId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            results.push({ type: action.type, success: true, details: `Updated '${data.name}'` });
          }
          break;
        }

        case 'create_organization': {
          const d = action.data as { name?: string; status?: string; strategic_value?: string; industry?: string };
          if (!d.name) {
            results.push({ type: action.type, success: false, details: 'Missing organization name' });
            break;
          }

          const { data, error } = await supabase
            .from('organizations')
            .insert({
              name: d.name,
              status: d.status || 'prospect',
              strategic_value: d.strategic_value || 'standard',
              industry: d.industry || null,
            })
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            results.push({ type: action.type, success: true, details: `Created organization '${data.name}'` });
          }
          break;
        }

        case 'get_client_health': {
          const d = action.data as { org_id?: string; org_name?: string };
          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find((o) => o.name.toLowerCase() === d.org_name!.toLowerCase());
            if (match) orgId = match.id;
          }

          if (!orgId) {
            results.push({ type: action.type, success: false, details: 'Could not identify client' });
            break;
          }

          // Fetch commitments for this org
          const { data: orgCommitments } = await supabase
            .from('commitments')
            .select('title, commitment_type, status, due_date, owner, completed_at')
            .eq('org_id', orgId)
            .order('created_at', { ascending: false })
            .limit(20);

          const { data: orgTranscripts } = await supabase
            .from('transcripts')
            .select('title, transcript_date, summary')
            .eq('org_id', orgId)
            .eq('is_processed', true)
            .order('transcript_date', { ascending: false })
            .limit(5);

          const open = (orgCommitments || []).filter((c) => ['pending', 'in_progress', 'waiting', 'snoozed'].includes(c.status));
          const overdue = open.filter((c) => c.due_date && new Date(c.due_date) < new Date());
          const completed = (orgCommitments || []).filter((c) => c.status === 'completed');
          const lastSession = orgTranscripts?.[0];

          const healthReport = `Open commitments: ${open.length} (${overdue.length} overdue)
Completed: ${completed.length}
Follow-through rate: ${orgCommitments && orgCommitments.length > 0 ? Math.round((completed.length / orgCommitments.length) * 100) : 0}%
Last session: ${lastSession ? `${lastSession.title} (${lastSession.transcript_date})` : 'No sessions'}
${lastSession?.summary ? `Summary: ${lastSession.summary.substring(0, 200)}` : ''}
Recent transcripts: ${(orgTranscripts || []).map((t) => `${t.title} (${t.transcript_date})`).join(', ') || 'None'}`;

          results.push({ type: action.type, success: true, details: healthReport });
          break;
        }

        case 'get_prep': {
          const d = action.data as { org_id?: string; org_name?: string };
          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find((o) => o.name.toLowerCase() === d.org_name!.toLowerCase());
            if (match) orgId = match.id;
          }

          if (!orgId) {
            results.push({ type: action.type, success: false, details: 'Could not identify client for prep' });
            break;
          }

          // Call the prep API internally
          try {
            const prepUrl = new URL('/api/prep', baseUrl);
            prepUrl.searchParams.set('org_id', orgId);
            const prepRes = await fetch(prepUrl.toString());
            if (prepRes.ok) {
              const prepData = await prepRes.json();
              const prepText = `**Last Session:** ${prepData.last_session_recap || 'No previous session'}

**Open Items:** ${(prepData.open_items || []).join('; ') || 'None'}

**What They're Avoiding:** ${prepData.what_theyre_avoiding || 'Nothing flagged'}

**Mood Trajectory:** ${prepData.mood_trajectory || 'Unknown'}

**Provocative Question:** ${prepData.provocative_question || 'None generated'}

**Watch For:** ${prepData.watch_for || 'Nothing specific'}`;
              results.push({ type: action.type, success: true, details: prepText });
            } else {
              results.push({ type: action.type, success: false, details: 'Prep generation failed' });
            }
          } catch {
            results.push({ type: action.type, success: false, details: 'Prep generation failed' });
          }
          break;
        }

        case 'create_contact': {
          const d = action.data as { org_id?: string; org_name?: string; name?: string; role?: string; email?: string; relationship_type?: string; notes?: string };
          if (!d.name) {
            results.push({ type: action.type, success: false, details: 'Missing contact name' });
            break;
          }

          let orgId = d.org_id || null;
          if (!orgId && d.org_name) {
            const match = allOrgs.find((o) => o.name.toLowerCase() === d.org_name!.toLowerCase());
            if (match) orgId = match.id;
          }

          const { data, error } = await supabase
            .from('contacts')
            .insert({
              name: d.name,
              org_id: orgId,
              role: d.role || null,
              email: d.email || null,
              relationship_type: d.relationship_type || null,
              notes: d.notes || null,
            })
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            results.push({ type: action.type, success: true, details: `Created contact '${data.name}'${orgId ? ' for ' + (d.org_name || orgId) : ''}` });
          }
          break;
        }

        case 'update_contact': {
          const d = action.data as { id?: string; name?: string; org_name?: string; updates?: Record<string, unknown> };
          let contactId = d.id;

          if (!contactId && d.name) {
            let query = supabase.from('contacts').select('id, name').ilike('name', `%${d.name}%`).limit(1);
            if (d.org_name) {
              const match = allOrgs.find((o) => o.name.toLowerCase() === d.org_name!.toLowerCase());
              if (match) query = query.eq('org_id', match.id);
            }
            const { data: found } = await query.single();
            if (found) contactId = found.id;
          }

          if (!contactId) {
            results.push({ type: action.type, success: false, details: 'Could not identify contact to update' });
            break;
          }

          const updates = d.updates || {};
          const { data, error } = await supabase
            .from('contacts')
            .update(updates)
            .eq('id', contactId)
            .select()
            .single();

          if (error) {
            results.push({ type: action.type, success: false, details: `DB error: ${error.message}` });
          } else {
            results.push({ type: action.type, success: true, details: `Updated contact '${data.name}'` });
          }
          break;
        }

        case 'create_engagement': {
          const data = action.data as Record<string, unknown>;
          let engOrgId = data.org_id as string | undefined;
          if (!engOrgId && data.org_name) {
            const { data: matchedOrg } = await supabase
              .from('organizations')
              .select('id')
              .ilike('name', `%${data.org_name}%`)
              .limit(1)
              .single();
            engOrgId = matchedOrg?.id;
          }
          const { error: engError } = await supabase.from('engagements').insert({
            org_id: engOrgId || null,
            name: data.name || 'Untitled',
            type: data.type || null,
            status: data.status || 'active',
            value_amount: data.value_amount || null,
            start_date: data.start_date || null,
            end_date: data.end_date || null,
            notes: data.notes || null,
          });
          if (engError) throw new Error(engError.message);
          results.push({ type: action.type, success: true, details: `Created engagement '${data.name}'${engOrgId ? '' : ' (no org matched)'}` });
          break;
        }

        case 'update_engagement': {
          const data = action.data as Record<string, unknown>;
          const updates = data.updates as Record<string, unknown> || {};
          const { error: updEngErr } = await supabase
            .from('engagements')
            .update(updates)
            .eq('id', data.id as string);
          if (updEngErr) throw new Error(updEngErr.message);
          results.push({ type: action.type, success: true, details: `Updated engagement ${data.id}` });
          break;
        }

        case 'update_business_context': {
          const data = action.data as Record<string, unknown>;
          const updates = data.updates as Record<string, unknown>;
          if (updates) {
            const { data: existing } = await supabase
              .from('josh_profile')
              .select('id, profile_data')
              .eq('profile_type', 'business_context')
              .single();
            if (existing) {
              const current = existing.profile_data as Record<string, unknown>;
              // Shallow merge for top-level keys, deep merge for nested objects
              const merged = { ...current };
              for (const [key, value] of Object.entries(updates)) {
                if (key.includes('.')) {
                  // Dot notation: e.g. "revenue_model.current_quarter.closed" = 200000
                  const parts = key.split('.');
                  let target = merged as Record<string, unknown>;
                  for (let i = 0; i < parts.length - 1; i++) {
                    if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
                      target[parts[i]] = {};
                    }
                    target = target[parts[i]] as Record<string, unknown>;
                  }
                  target[parts[parts.length - 1]] = value;
                } else {
                  merged[key] = value;
                }
              }
              merged['updated_at'] = new Date().toISOString();
              await supabase
                .from('josh_profile')
                .update({ profile_data: merged, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
              results.push({ type: action.type, success: true, details: 'Business context updated' });
            } else {
              results.push({ type: action.type, success: false, details: 'No business context profile found' });
            }
          }
          break;
        }

        case 'log_life_event': {
          const d = action.data as { log_type?: string; title?: string; description?: string; tags?: string[]; metadata?: Record<string, unknown> };
          if (!d.title) {
            results.push({ type: action.type, success: false, details: 'Missing title' });
            break;
          }
          const { error } = await supabase.from('life_logs').insert({
            log_type: d.log_type || 'habit',
            title: d.title,
            description: d.description || null,
            tags: d.tags || [],
            metadata: d.metadata || null,
            logged_at: new Date().toISOString(),
          });
          if (error) {
            results.push({ type: action.type, success: false, details: error.message });
          } else {
            results.push({ type: action.type, success: true, details: `Logged: ${d.title}` });
          }
          break;
        }

        case 'set_goal': {
          const d = action.data as { title?: string; type?: string; frequency?: string; target?: number; tracking_tag?: string; due_date?: string; milestones?: string[] };
          if (!d.title) {
            results.push({ type: action.type, success: false, details: 'Missing goal title' });
            break;
          }
          const { data: existingGoals } = await supabase
            .from('josh_profile')
            .select('id, profile_data')
            .eq('profile_type', 'personal_goals')
            .single();

          const goalId = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const newGoal = {
            id: goalId,
            title: d.title,
            type: d.type || 'recurring',
            frequency: d.frequency || 'weekly',
            target: d.target || 1,
            tracking_tag: d.tracking_tag || goalId,
            due_date: d.due_date || null,
            milestones: d.milestones || null,
            current_milestone: 0,
            active: true,
          };

          if (existingGoals) {
            const current = existingGoals.profile_data as { goals?: Array<Record<string, unknown>> };
            const goals = current.goals || [];
            goals.push(newGoal);
            await supabase.from('josh_profile').update({
              profile_data: { ...current, goals, updated_at: new Date().toISOString() },
            }).eq('id', existingGoals.id);
          } else {
            await supabase.from('josh_profile').insert({
              profile_type: 'personal_goals',
              profile_data: { goals: [newGoal], updated_at: new Date().toISOString() },
            });
          }
          results.push({ type: action.type, success: true, details: `Goal set: ${d.title}` });
          break;
        }

        case 'update_goal_progress': {
          const d = action.data as { goal_id?: string; current_milestone?: number; active?: boolean };
          if (!d.goal_id) {
            results.push({ type: action.type, success: false, details: 'Missing goal_id' });
            break;
          }
          const { data: gp } = await supabase
            .from('josh_profile')
            .select('id, profile_data')
            .eq('profile_type', 'personal_goals')
            .single();

          if (gp) {
            const pd = gp.profile_data as { goals?: Array<Record<string, unknown>> };
            const goals = pd.goals || [];
            const goal = goals.find((g) => g.id === d.goal_id);
            if (goal) {
              if (d.current_milestone !== undefined) goal.current_milestone = d.current_milestone;
              if (d.active !== undefined) goal.active = d.active;
              await supabase.from('josh_profile').update({
                profile_data: { ...pd, goals, updated_at: new Date().toISOString() },
              }).eq('id', gp.id);
              results.push({ type: action.type, success: true, details: `Goal updated: ${goal.title}` });
            } else {
              results.push({ type: action.type, success: false, details: 'Goal not found' });
            }
          }
          break;
        }

        case 'create_strategic_note': {
          const d = action.data as { title?: string; content?: string; tags?: string[]; org_name?: string };
          if (!d.title || !d.content) {
            results.push({ type: action.type, success: false, details: 'Missing title or content' });
            break;
          }

          let noteOrgId: string | null = null;
          if (d.org_name) {
            const match = allOrgs.find(o => o.name.toLowerCase() === d.org_name!.toLowerCase());
            if (match) noteOrgId = match.id;
          }

          const noteId = `note-${Date.now()}-${d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
          const newNote = {
            id: noteId,
            title: d.title,
            content: d.content,
            tags: d.tags || [],
            org_id: noteOrgId,
            org_name: d.org_name || null,
            created_at: new Date().toISOString(),
          };

          const { data: existingNotes } = await supabase
            .from('josh_profile')
            .select('id, profile_data')
            .eq('profile_type', 'strategic_notes')
            .single();

          if (existingNotes) {
            const current = existingNotes.profile_data as { notes?: Array<Record<string, unknown>> };
            const notes = current.notes || [];
            notes.unshift(newNote);
            if (notes.length > 50) notes.length = 50;
            await supabase.from('josh_profile').update({
              profile_data: { notes, updated_at: new Date().toISOString() },
            }).eq('id', existingNotes.id);
          } else {
            await supabase.from('josh_profile').insert({
              profile_type: 'strategic_notes',
              profile_data: { notes: [newNote], updated_at: new Date().toISOString() },
            });
          }
          results.push({ type: action.type, success: true, details: `Strategic note saved: "${d.title}"` });
          break;
        }

        default:
          results.push({ type: action.type, success: false, details: `Unknown action type: ${action.type}` });
      }
    } catch (err) {
      console.error(`Action ${action.type} failed:`, err);
      results.push({ type: action.type, success: false, details: `Action failed: ${(err as Error).message}` });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Parse Claude's response — may be plain text or structured JSON
// ---------------------------------------------------------------------------

function parseStructuredResponse(text: string): StructuredResponse {
  // Try to extract JSON from the response (Claude may wrap it in markdown code fences)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/^\s*(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.message && typeof parsed.message === 'string') {
        return {
          message: parsed.message,
          actions: Array.isArray(parsed.actions) ? parsed.actions : undefined,
        };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Try parsing the whole thing as JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed.message && typeof parsed.message === 'string') {
      return {
        message: parsed.message,
        actions: Array.isArray(parsed.actions) ? parsed.actions : undefined,
      };
    }
  } catch {
    // Not JSON, treat as plain message
  }

  // Claude sometimes outputs conversational text BEFORE the JSON block.
  // Find the last top-level JSON object in the response.
  const embeddedJsonMatch = text.match(/(\{[\s\S]*"message"\s*:\s*"[\s\S]*"actions"\s*:\s*\[[\s\S]*\][\s\S]*\})\s*$/);
  if (embeddedJsonMatch) {
    try {
      const parsed = JSON.parse(embeddedJsonMatch[1]);
      if (parsed.message && typeof parsed.message === 'string') {
        return {
          message: parsed.message,
          actions: Array.isArray(parsed.actions) ? parsed.actions : undefined,
        };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  return { message: text };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [] } = body as {
      message: string;
      history?: ChatMessage[];
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const intent = detectIntent(message);

    // Collect context pieces
    const contextParts: string[] = [];

    // Always fetch ALL orgs (needed for action resolution and context)
    const { data: allOrgs } = await supabase
      .from('organizations')
      .select('id, name, status, strategic_value, industry, is_own_business');

    const orgList = allOrgs || [];

    // Always fetch Josh's voice profile + methodology for deep understanding
    const { data: profileRows } = await supabase
      .from('josh_profile')
      .select('profile_type, profile_data');

    const profileMap: Record<string, unknown> = {};
    for (const row of profileRows || []) {
      profileMap[row.profile_type] = row.profile_data;
    }

    // Fetch business context for strategic advisor capabilities
    const businessCtx = await getBusinessContext(supabase);
    const businessContextStr = formatBusinessContextForPrompt(businessCtx);
    if (businessContextStr) {
      contextParts.push(businessContextStr);
    }

    // Always fetch recent activity so chat knows what Josh just did
    const { data: recentActivity } = await supabase
      .from('commitment_activity')
      .select('action, details, created_at, commitment:commitments(title)')
      .order('created_at', { ascending: false })
      .limit(10);

    // Always fetch top commitments for general context
    const { data: commitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, owner, due_date, status, escalation_level, org_id, category')
      .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
      .order('priority_score', { ascending: false })
      .limit(20);

    // Build org name map for commitments
    const cmtOrgIds = [...new Set((commitments || []).map((c) => c.org_id).filter(Boolean))];
    let cmtOrgMap = new Map<string, string>();
    if (cmtOrgIds.length > 0) {
      const { data: cmtOrgs } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', cmtOrgIds);
      cmtOrgMap = new Map((cmtOrgs || []).map((o: { id: string; name: string }) => [o.id, o.name]));
    }

    if (commitments && commitments.length > 0) {
      // Separate client commitments from internal LeadShift ones
      const ownBizIds = new Set(orgList.filter((o) => o.is_own_business).map((o) => o.id));
      const clientCommitments = commitments.filter((c) => !c.org_id || !ownBizIds.has(c.org_id));
      const internalCommitments = commitments.filter((c) => c.org_id && ownBizIds.has(c.org_id));

      const overdueItems = clientCommitments.filter(
        (c) => c.due_date && new Date(c.due_date) < new Date() && c.status !== 'waiting'
      );
      const dueToday = clientCommitments.filter((c) => {
        if (!c.due_date) return false;
        const d = new Date(c.due_date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      });

      const formatCmt = (c: typeof commitments[0]) => {
        const orgName = c.org_id ? cmtOrgMap.get(c.org_id) : null;
        return `- [id:${c.id}] [${c.owner === 'josh' ? 'Josh' : 'Other'}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''}${orgName ? ', ' + orgName : ''})`;
      };

      contextParts.push(`CLIENT COMMITMENTS (${clientCommitments.length} open):
Top priorities:
${clientCommitments.slice(0, 10).map(formatCmt).join('\n')}
${overdueItems.length > 0 ? `\nOVERDUE (${overdueItems.length}): ${overdueItems.map((c) => `${c.title} [id:${c.id}]`).join(', ')}` : ''}
${dueToday.length > 0 ? `\nDUE TODAY (${dueToday.length}): ${dueToday.map((c) => `${c.title} [id:${c.id}]`).join(', ')}` : ''}
${internalCommitments.length > 0 ? `\nINTERNAL LEADSHIFT TASKS (${internalCommitments.length}): ${internalCommitments.slice(0, 5).map((c) => `${c.title} [id:${c.id}]`).join(', ')}${internalCommitments.length > 5 ? ` ... and ${internalCommitments.length - 5} more` : ''}` : ''}`);
    }

    // Fetch calendar events with AI analysis (prep notes, event type)
    {
      const now = new Date();
      const twoWeeksOut = new Date(now);
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

      const { data: events } = await supabase
        .from('calendar_events')
        .select('subject, start_time, end_time, location, ai_analysis, org_id')
        .gte('start_time', now.toISOString())
        .lte('start_time', twoWeeksOut.toISOString())
        .order('start_time', { ascending: true })
        .limit(30);

      // Filter out personal events (Sleep, Deep Work, etc.)
      const businessEvents = (events || []).filter((e) => {
        const aiData = e.ai_analysis as Record<string, unknown> | null;
        return aiData?.event_type !== 'personal';
      });

      if (businessEvents.length > 0) {
        // Fetch org names for events
        const eventOrgIds = [...new Set(businessEvents.map((e) => e.org_id).filter(Boolean))];
        let eventOrgMap = new Map<string, string>();
        if (eventOrgIds.length > 0) {
          const { data: eventOrgs } = await supabase
            .from('organizations')
            .select('id, name')
            .in('id', eventOrgIds);
          eventOrgMap = new Map((eventOrgs || []).map((o: { id: string; name: string }) => [o.id, o.name]));
        }

        // Split into this week and next week
        const oneWeekOut = new Date(now);
        oneWeekOut.setDate(oneWeekOut.getDate() + 7);
        const thisWeek = businessEvents.filter((e) => new Date(e.start_time) < oneWeekOut);
        const nextWeek = businessEvents.filter((e) => new Date(e.start_time) >= oneWeekOut);

        const formatEvent = (e: typeof businessEvents[0]) => {
          const orgName = e.org_id ? eventOrgMap.get(e.org_id as string) : null;
          const start = new Date(e.start_time);
          const aiData = e.ai_analysis as Record<string, unknown> | null;
          const prepNotes = aiData?.prep_notes ? ` | Prep: ${aiData.prep_notes}` : '';
          const eventType = aiData?.event_type ? ` [${aiData.event_type}]` : '';
          const importance = aiData?.importance === 'high' ? ' ⚡HIGH' : '';
          return `- ${start.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })} ${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}: ${e.subject || 'Untitled'}${eventType}${importance}${orgName ? ' (' + orgName + ')' : ''}${e.location ? ' @ ' + e.location : ''}${prepNotes}`;
        };

        if (thisWeek.length > 0) {
          contextParts.push(`CALENDAR — THIS WEEK (${thisWeek.length} events):
${thisWeek.map(formatEvent).join('\n')}`);
        }
        if (nextWeek.length > 0) {
          contextParts.push(`CALENDAR — NEXT WEEK (${nextWeek.length} events):
${nextWeek.map(formatEvent).join('\n')}`);
        }
      }
    }

    // Always include client list for context
    const ownBiz = orgList.find((o) => o.is_own_business);
    const clientOrgs = orgList.filter((o) => !o.is_own_business);
    if (orgList.length > 0) {
      contextParts.push(`${ownBiz ? `JOSH'S OWN BUSINESS: ${ownBiz.name} [id:${ownBiz.id}] — This is Josh's company, NOT a client. LeadShift team members are colleagues, not clients.\n\n` : ''}ALL CLIENTS:
${clientOrgs.map((o) => `- [id:${o.id}] ${o.name} (${o.status}, ${o.strategic_value}, ${o.industry || 'no industry'})`).join('\n')}`);
    }

    // Include Josh's FULL profile context (all profile types)
    {
      const profileParts: string[] = [];
      const coaching = profileMap['coaching_voice'] as Record<string, unknown> | undefined;
      const writing = profileMap['writing_style'] as Record<string, unknown> | undefined;
      const themeAlerts = profileMap['theme_alerts'] as Record<string, unknown> | undefined;
      const priorityPatterns = profileMap['priority_patterns'] as Record<string, unknown> | undefined;
      const priorityInsights = profileMap['priority_patterns_insights'] as Record<string, unknown> | undefined;

      if (coaching) {
        if (coaching.frameworks_deployed) profileParts.push(`Frameworks Josh uses: ${JSON.stringify(coaching.frameworks_deployed)}`);
        if (coaching.signature_phrases) profileParts.push(`Signature phrases: ${JSON.stringify(coaching.signature_phrases)}`);
        if (coaching.coaching_style) profileParts.push(`Coaching style: ${JSON.stringify(coaching.coaching_style)}`);
      }
      if (writing) {
        profileParts.push(`Writing style: ${JSON.stringify(writing).substring(0, 500)}`);
      }
      if (themeAlerts) {
        profileParts.push(`Theme alerts (cross-client patterns): ${JSON.stringify(themeAlerts).substring(0, 500)}`);
      }
      if (priorityPatterns) {
        profileParts.push(`Priority patterns: ${JSON.stringify(priorityPatterns).substring(0, 300)}`);
      }
      if (priorityInsights) {
        profileParts.push(`Priority insights: ${JSON.stringify(priorityInsights).substring(0, 300)}`);
      }
      profileParts.push('Known frameworks: Language Leaks (Agency/Identity/Worth), Signal Model, Predictive Index, Five Dysfunctions, EQ-i 2.0');

      contextParts.push(`JOSH'S PROFILE:\n${profileParts.join('\n')}`);
    }

    // Fetch recent emails — both inbox and sent for full picture
    const { data: recentEmails } = await supabase
      .from('emails')
      .select('subject, sender, sender_email, body_preview, received_at, sent_at, folder, org_id, ai_extraction, review_status')
      .order('received_at', { ascending: false })
      .limit(25);

    if (recentEmails && recentEmails.length > 0) {
      // Fetch org names separately to avoid join issues
      const emailOrgIds = [...new Set(recentEmails.map((e) => e.org_id).filter(Boolean))];
      let emailOrgMap = new Map<string, string>();
      if (emailOrgIds.length > 0) {
        const { data: emailOrgs } = await supabase
          .from('organizations')
          .select('id, name')
          .in('id', emailOrgIds);
        emailOrgMap = new Map((emailOrgs || []).map((o: { id: string; name: string }) => [o.id, o.name]));
      }

      const inboxEmails = recentEmails.filter((e) => e.folder !== 'sent');
      const sentEmails = recentEmails.filter((e) => e.folder === 'sent');

      if (inboxEmails.length > 0) {
        contextParts.push(`RECENT INBOX EMAILS (${inboxEmails.length}):
${inboxEmails.map((e) => {
          const orgName = e.org_id ? emailOrgMap.get(e.org_id as string) : null;
          const ai = e.ai_extraction as Record<string, unknown> | null;
          const urgency = ai?.reply_urgency && ai.reply_urgency !== 'none' ? ` [reply: ${ai.reply_urgency}]` : '';
          const sentiment = ai?.sentiment && ai.sentiment !== 'neutral' ? ` [${ai.sentiment}]` : '';
          const intel = ai?.client_intelligence as Record<string, unknown> | null;
          const topics = Array.isArray(intel?.key_topics) ? ` | Topics: ${(intel.key_topics as string[]).join(', ')}` : '';
          return `- ${new Date(e.received_at as string).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}: "${e.subject}" from ${e.sender}${orgName ? ' (' + orgName + ')' : ''}${urgency}${sentiment}${topics}${ai?.email_summary ? '\n  Summary: ' + ai.email_summary : ''}`;
        }).join('\n')}`);
      }

      if (sentEmails.length > 0) {
        contextParts.push(`JOSH'S RECENT SENT EMAILS (${sentEmails.length}):
${sentEmails.map((e) => {
          const orgName = e.org_id ? emailOrgMap.get(e.org_id as string) : null;
          const ai = e.ai_extraction as Record<string, unknown> | null;
          return `- ${new Date((e.sent_at || e.received_at) as string).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}: "${e.subject}" to ${Array.isArray(e.sender) ? e.sender : 'recipients'}${orgName ? ' (' + orgName + ')' : ''}${ai?.email_summary ? '\n  Summary: ' + ai.email_summary : ''}`;
        }).join('\n')}`);
      }
    }

    // Fetch emails needing reply so the Brain knows what's pending
    {
      const { data: needsReplyEmails } = await supabase
        .from('emails')
        .select('subject, sender, received_at, ai_extraction, org_id')
        .eq('is_processed', true)
        .not('review_status', 'in', '("dismissed","accepted","reviewed")')
        .neq('folder', 'sent')
        .order('received_at', { ascending: false })
        .limit(20);

      const replyEmails = (needsReplyEmails || []).filter((e) => {
        const ai = e.ai_extraction as Record<string, unknown> | null;
        return ai?.needs_reply === true;
      });

      if (replyEmails.length > 0) {
        contextParts.push(`EMAILS NEEDING REPLY (${replyEmails.length}):
${replyEmails.map((e) => {
          const ai = e.ai_extraction as Record<string, unknown> | null;
          const urgency = ai?.reply_urgency || 'unknown';
          return `- ${e.sender}: "${e.subject}" (${urgency}) — received ${new Date(e.received_at as string).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`;
        }).join('\n')}`);
      }
    }

    // Fetch personal life context (goals, habits, personal commitments)
    {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const [lifeLogs, goalsProfile, personalCommitments] = await Promise.all([
        supabase
          .from('life_logs')
          .select('log_type, title, tags, logged_at')
          .gte('logged_at', weekStart.toISOString())
          .order('logged_at', { ascending: false })
          .limit(20),
        supabase
          .from('josh_profile')
          .select('profile_data')
          .eq('profile_type', 'personal_goals')
          .single(),
        supabase
          .from('commitments')
          .select('id, title, commitment_type, due_date, status')
          .eq('category', 'personal')
          .in('status', ['pending', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(10),
      ]);

      const logs = lifeLogs.data || [];
      const goals = (goalsProfile.data?.profile_data as { goals?: Array<Record<string, unknown>> })?.goals || [];
      const pCommitments = personalCommitments.data || [];

      // Compute fitness streak
      const fitnessThisWeek = logs.filter((l) => l.tags?.includes('fitness')).length;

      const personalLines: string[] = ['=== PERSONAL LIFE CONTEXT ==='];

      if (goals.length > 0) {
        personalLines.push('Goals:');
        for (const g of goals.filter((g) => g.active)) {
          if (g.type === 'recurring') {
            const tag = g.tracking_tag as string;
            const target = g.target as number;
            const count = logs.filter((l) => l.tags?.includes(tag)).length;
            personalLines.push(`- ${g.title}: ${count}/${target} this week`);
          } else if (g.type === 'milestone') {
            const milestones = g.milestones as string[] | undefined;
            const current = g.current_milestone as number;
            personalLines.push(`- ${g.title}: ${milestones?.[current] || 'In progress'}${g.due_date ? ` (due ${g.due_date})` : ''}`);
          }
        }
      }

      if (logs.length > 0) {
        personalLines.push(`\nRecent life logs (${logs.length} this week):`);
        for (const l of logs.slice(0, 5)) {
          personalLines.push(`- ${l.title} [${l.tags?.join(', ') || l.log_type}] — ${new Date(l.logged_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`);
        }
        personalLines.push(`Fitness this week: ${fitnessThisWeek}`);
      } else {
        personalLines.push('\nNo life logs this week yet.');
      }

      if (pCommitments.length > 0) {
        personalLines.push(`\nPersonal commitments (${pCommitments.length} open):`);
        for (const c of pCommitments) {
          personalLines.push(`- [id:${c.id}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''})`);
        }
      }

      personalLines.push('=== END PERSONAL CONTEXT ===');
      contextParts.push(personalLines.join('\n'));
    }

    // Fetch engagements (workstreams, contracts, financial context)
    const { data: engagements } = await supabase
      .from('engagements')
      .select('name, type, status, value_amount, start_date, end_date, notes, org_id')
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (engagements && engagements.length > 0) {
      // Build org map for engagements
      const engOrgIds = [...new Set(engagements.map((e) => e.org_id).filter(Boolean))];
      let engOrgMap = new Map<string, string>();
      if (engOrgIds.length > 0) {
        const { data: engOrgs } = await supabase
          .from('organizations')
          .select('id, name')
          .in('id', engOrgIds);
        engOrgMap = new Map((engOrgs || []).map((o: { id: string; name: string }) => [o.id, o.name]));
      }

      contextParts.push(`ACTIVE ENGAGEMENTS/WORKSTREAMS:
${engagements.map((e) => {
        const orgName = e.org_id ? engOrgMap.get(e.org_id as string) : null;
        return `- ${e.name} (${e.type || 'unknown type'}, ${e.status})${orgName ? ' — ' + orgName : ''}${e.value_amount ? ' | $' + Number(e.value_amount).toLocaleString() : ''}${e.start_date ? ' | Started: ' + e.start_date : ''}${e.end_date ? ' | Ends: ' + e.end_date : ''}${e.notes ? ' | ' + e.notes.substring(0, 100) : ''}`;
      }).join('\n')}`);
    }

    // Fetch recent briefing summaries (so chat can reference them)
    const { data: recentBriefings } = await supabase
      .from('briefings')
      .select('briefing_type, summary, generated_at')
      .order('generated_at', { ascending: false })
      .limit(3);

    if (recentBriefings && recentBriefings.length > 0) {
      contextParts.push(`RECENT BRIEFINGS:
${recentBriefings.map((b) => {
        const summary = b.summary as Record<string, unknown> | null;
        return `- ${b.briefing_type} briefing (${new Date(b.generated_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}): ${summary ? JSON.stringify(summary).substring(0, 300) : 'No summary'}`;
      }).join('\n')}`);
    }

    // Include recent activity
    if (recentActivity && recentActivity.length > 0) {
      contextParts.push(`RECENT ACTIVITY (last ${recentActivity.length} actions):
${recentActivity.map((a) => {
        const c = a.commitment as unknown as { title?: string } | null;
        return `- ${a.action}: ${c?.title || 'unknown'} (${new Date(a.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })})`;
      }).join('\n')}`);
    }

    // ---------------------------------------------------------------
    // PRACTICE SNAPSHOT: Pre-computed practice-level intelligence
    // ---------------------------------------------------------------
    {
      const activeClientOrgs = orgList.filter(o => !o.is_own_business && o.status === 'active');
      const allOverdue = (commitments || []).filter(
        c => c.due_date && new Date(c.due_date) < new Date() && !['completed', 'cancelled', 'waiting'].includes(c.status)
      );
      const internalActive = (commitments || []).filter(c => c.category === 'internal').length;

      // Lifecycle stage distribution from pre-fetched profile data
      const lifecycleStagesRaw = profileMap['lifecycle_stages'] as Array<{ org_id: string; stage: string }> | undefined;
      const stageCounts: Record<string, number> = {};
      if (Array.isArray(lifecycleStagesRaw)) {
        for (const s of lifecycleStagesRaw) {
          stageCounts[s.stage] = (stageCounts[s.stage] || 0) + 1;
        }
      }
      const stageDistribution = Object.entries(stageCounts).map(([k, v]) => `${k}: ${v}`).join(', ');

      const bizProfile = businessCtx.profile as Record<string, unknown> | null;
      const revenueModel = bizProfile?.revenue_model as Record<string, unknown> | undefined;
      const currentQuarter = revenueModel?.current_quarter as Record<string, unknown> | undefined;
      const revenuePace = currentQuarter
        ? `Q target: $${Number(currentQuarter.target || 0).toLocaleString()} | Closed: $${Number(currentQuarter.closed || 0).toLocaleString()} | Gap: $${Number(currentQuarter.gap || 0).toLocaleString()}`
        : 'No quarterly revenue data';
      const activePriorities = bizProfile?.active_priorities as string[] | undefined;

      contextParts.push(`PRACTICE SNAPSHOT:
Active clients: ${activeClientOrgs.length} | Internal tasks: ${internalActive} | Overdue commitments: ${allOverdue.length}
${stageDistribution ? `Lifecycle distribution: ${stageDistribution}` : ''}
Revenue pace: ${revenuePace}
${activePriorities && activePriorities.length > 0 ? `Active priorities: ${activePriorities.join('; ')}` : ''}`);
    }

    // Include recent strategic notes for planning continuity
    const strategicNotes = profileMap['strategic_notes'] as { notes?: Array<{ id: string; title: string; content: string; tags?: string[]; org_name?: string; created_at: string }> } | undefined;
    if (strategicNotes?.notes && strategicNotes.notes.length > 0) {
      const recentNotes = strategicNotes.notes.slice(0, 5);
      contextParts.push(`STRATEGIC NOTES (${strategicNotes.notes.length} total, showing recent ${recentNotes.length}):
${recentNotes.map(n => `- "${n.title}"${n.org_name ? ` [${n.org_name}]` : ''} (${n.created_at.split('T')[0]})${n.tags?.length ? ` #${n.tags.join(' #')}` : ''}
  ${n.content.substring(0, 300)}${n.content.length > 300 ? '...' : ''}`).join('\n')}`);
    }

    // ---------------------------------------------------------------
    // DEEP CLIENT CONTEXT: When a client is mentioned, auto-fetch
    // their full data (transcripts, commitments, contacts, health)
    // ---------------------------------------------------------------
    const mentionedOrgs = detectMentionedOrgs(message, orgList);
    for (const org of mentionedOrgs) {
      try {
        // Fetch org details (including intelligence JSONB for revenue/tier context)
        const { data: orgDetail } = await supabase
          .from('organizations')
          .select('name, industry, status, strategic_value, notes, intelligence')
          .eq('id', org.id)
          .single();

        // Fetch all commitments for this org (open + recent completed)
        const { data: orgCommitments } = await supabase
          .from('commitments')
          .select('id, title, commitment_type, status, due_date, owner, other_party, description, completed_at, created_at')
          .eq('org_id', org.id)
          .order('priority_score', { ascending: false })
          .limit(30);

        // Fetch transcripts with deep detail (summaries, themes, language leaks, insights)
        const { data: orgTranscripts } = await supabase
          .from('transcripts')
          .select('id, title, transcript_date, transcript_type, summary, key_themes, client_insights, session_arc, notable_quotes, recommended_focus_next_session, duration_minutes')
          .eq('org_id', org.id)
          .eq('is_processed', true)
          .order('transcript_date', { ascending: false })
          .limit(10);

        // Fetch contacts with full profile data
        const { data: orgContacts } = await supabase
          .from('contacts')
          .select('id, name, role, title, email, phone, relationship_type, category, notes, personality_notes, coaching_focus, communication_style')
          .eq('org_id', org.id);

        // Fetch assessments for all contacts in this org
        const contactIds = (orgContacts || []).map((c) => c.id);
        const { data: orgAssessments } = contactIds.length > 0
          ? await supabase
              .from('assessments')
              .select('contact_id, assessment_type, title, summary, key_findings, ai_analysis, assessment_date')
              .in('contact_id', contactIds)
          : { data: [] };

        // Fetch calendar events for this client
        const { data: orgEvents } = await supabase
          .from('calendar_events')
          .select('subject, start_time, end_time')
          .eq('org_id', org.id)
          .gte('start_time', new Date(Date.now() - 30 * 86400000).toISOString())
          .order('start_time', { ascending: false })
          .limit(10);

        // Fetch engagement/deal history for this org
        const { data: orgEngagements } = await supabase
          .from('engagements')
          .select('name, type, status, value_amount, start_date, end_date, notes')
          .eq('org_id', org.id)
          .order('start_date', { ascending: false })
          .limit(20);

        // Build health metrics + relationship intelligence
        const openCmts = (orgCommitments || []).filter((c) => ['pending', 'in_progress', 'waiting', 'snoozed'].includes(c.status));
        const overdueCmts = openCmts.filter((c) => c.due_date && new Date(c.due_date) < new Date());
        const waitingCmts = openCmts.filter((c) => c.status === 'waiting');
        const completedCmts = (orgCommitments || []).filter((c) => c.status === 'completed');
        const totalCmts = orgCommitments?.length || 0;
        const followThroughRate = totalCmts > 0 ? Math.round((completedCmts.length / totalCmts) * 100) : 0;
        const lastSession = orgTranscripts?.[0];
        const daysSinceContact = lastSession
          ? Math.round((Date.now() - new Date(lastSession.transcript_date).getTime()) / 86400000)
          : null;

        // Compute relationship health score (0-100)
        const followThroughScore = totalCmts > 0 ? Math.round((completedCmts.length / totalCmts) * 25) : 25;
        let avgDaysBetween: number | null = null;
        if (orgTranscripts && orgTranscripts.length >= 2) {
          const dates = orgTranscripts.map((t: { transcript_date: string }) => new Date(t.transcript_date).getTime());
          let totalGap = 0;
          for (let i = 0; i < dates.length - 1; i++) {
            totalGap += dates[i] - dates[i + 1];
          }
          avgDaysBetween = Math.round(totalGap / (dates.length - 1) / (1000 * 60 * 60 * 24));
        }
        const healthScore = Math.min(100, Math.max(0,
          scoreContactRecency(daysSinceContact ?? 999) +
          followThroughScore +
          scoreOverdueHealth(overdueCmts.length) +
          scoreFrequency(avgDaysBetween)
        ));
        const healthLabel = healthStatusLabel(healthScore);

        // Compute follow-up urgency (0-100)
        const urgencyScore = followUpUrgency(
          overdueCmts.length,
          daysSinceContact ?? 999,
          waitingCmts.length,
          orgDetail?.strategic_value || 'standard'
        );

        // Lifecycle stage from pre-fetched profile data
        const lifecycleStagesRaw = profileMap['lifecycle_stages'] as Array<{ org_id: string; stage: string; confidence?: number; signals?: string[] }> | undefined;
        const orgLifecycle = Array.isArray(lifecycleStagesRaw) ? lifecycleStagesRaw.find(s => s.org_id === org.id) : null;

        // Revenue context from engagements
        const revenueStr = formatOrgRevenueForPrompt(org.id, businessCtx.orgRevenue, orgEngagements || undefined);

        // Org intelligence JSONB (tier, cross-sell potential, etc.)
        const orgIntel = (orgDetail as Record<string, unknown> | null)?.intelligence as Record<string, unknown> | undefined;

        let clientBlock = `\n\nDEEP CLIENT DATA — ${org.name.toUpperCase()}:
Organization: ${orgDetail?.name || org.name} | Status: ${orgDetail?.status} | Strategic value: ${orgDetail?.strategic_value} | Industry: ${orgDetail?.industry || 'Unknown'}
${orgDetail?.notes ? `Notes: ${orgDetail.notes}` : ''}
${revenueStr ? revenueStr + '\n' : ''}${orgIntel?.relationship_depth ? `Relationship depth: ${orgIntel.relationship_depth}\n` : ''}${orgIntel?.cross_sell_potential ? `Cross-sell potential: ${JSON.stringify(orgIntel.cross_sell_potential)}\n` : ''}Health: Score ${healthScore}/100 (${healthLabel}) | ${openCmts.length} open commitments (${overdueCmts.length} overdue) | Follow-through: ${followThroughRate}%${avgDaysBetween ? ` | Session cadence: ~${avgDaysBetween} days` : ''}
${daysSinceContact !== null ? `Days since last session: ${daysSinceContact}` : 'No sessions recorded'}
${orgLifecycle ? `Lifecycle stage: ${orgLifecycle.stage}${orgLifecycle.signals ? ` | Signals: ${orgLifecycle.signals.join('; ')}` : ''}` : ''}Follow-up urgency: ${urgencyScore}/100${urgencyScore >= 60 ? ' (HIGH PRIORITY)' : urgencyScore >= 30 ? ' (medium)' : ' (low)'}`;

        // Contacts with full profiles and assessments
        if (orgContacts && orgContacts.length > 0) {
          const assessmentsByContact = new Map<string, typeof orgAssessments>();
          for (const a of (orgAssessments || [])) {
            const list = assessmentsByContact.get(a.contact_id) || [];
            list.push(a);
            assessmentsByContact.set(a.contact_id, list);
          }

          clientBlock += `\n\nPeople/Contacts:`;
          for (const c of orgContacts) {
            clientBlock += `\n- ${c.name}`;
            if (c.title) clientBlock += `, ${c.title}`;
            if (c.role) clientBlock += ` (${c.role})`;
            if (c.relationship_type && c.relationship_type.length > 0) clientBlock += ` [${Array.isArray(c.relationship_type) ? c.relationship_type.join(', ') : c.relationship_type}]`;
            if (c.email) clientBlock += ` <${c.email}>`;
            if (c.phone) clientBlock += ` ph:${c.phone}`;
            if (c.coaching_focus) clientBlock += `\n  Coaching focus: ${c.coaching_focus}`;
            if (c.personality_notes) clientBlock += `\n  Personality: ${c.personality_notes}`;
            if (c.communication_style) clientBlock += `\n  Communication style: ${c.communication_style}`;
            if (c.notes) clientBlock += `\n  Notes: ${c.notes}`;

            const assessments = assessmentsByContact.get(c.id);
            if (assessments && assessments.length > 0) {
              for (const a of assessments) {
                clientBlock += `\n  Assessment — ${a.title} (${a.assessment_type}${a.assessment_date ? ', ' + a.assessment_date : ''})`;
                if (a.summary) clientBlock += `: ${a.summary}`;
                if (a.key_findings) {
                  const kf = a.key_findings as Record<string, unknown>;
                  if (Array.isArray(kf.areas_of_strength) && kf.areas_of_strength.length) clientBlock += `\n    Strengths: ${kf.areas_of_strength.join('; ')}`;
                  if (Array.isArray(kf.development_areas) && kf.development_areas.length) clientBlock += `\n    Development areas: ${kf.development_areas.join('; ')}`;
                  if (Array.isArray(kf.behavioral_drives) && kf.behavioral_drives.length) clientBlock += `\n    Behavioral drives: ${kf.behavioral_drives.join('; ')}`;
                  if (kf.under_pressure) clientBlock += `\n    Under pressure: ${kf.under_pressure}`;
                }
                if (a.ai_analysis) clientBlock += `\n    Coaching analysis: ${a.ai_analysis}`;
              }
            }
          }
        }

        // All open commitments
        if (openCmts.length > 0) {
          clientBlock += `\n\nOpen commitments for ${org.name}:
${openCmts.map((c) => `- [id:${c.id}] [${c.owner}] ${c.title} (${c.commitment_type}, ${c.status}${c.due_date ? ', due ' + c.due_date.split('T')[0] : ''}${c.other_party ? ', other: ' + c.other_party : ''})`).join('\n')}`;
        }

        // Recent completed
        if (completedCmts.length > 0) {
          clientBlock += `\n\nRecently completed for ${org.name}:
${completedCmts.slice(0, 5).map((c) => `- ${c.title} (completed ${c.completed_at ? c.completed_at.split('T')[0] : 'unknown'})`).join('\n')}`;
        }

        // Transcripts with summaries, themes, insights
        if (orgTranscripts && orgTranscripts.length > 0) {
          clientBlock += `\n\nSession history for ${org.name} (${orgTranscripts.length} sessions):`;
          for (const t of orgTranscripts) {
            clientBlock += `\n\n--- ${t.title || t.transcript_type || 'Session'} (${t.transcript_date})${t.duration_minutes ? ' [' + t.duration_minutes + 'min]' : ''} ---`;
            if (t.summary) clientBlock += `\nSummary: ${t.summary}`;
            if (t.session_arc) clientBlock += `\nArc: ${t.session_arc}`;
            if (t.key_themes && Array.isArray(t.key_themes) && t.key_themes.length > 0) {
              const themes = t.key_themes.map((th: string | { theme: string }) => typeof th === 'string' ? th : th.theme);
              clientBlock += `\nThemes: ${themes.join(', ')}`;
            }
            if (t.client_insights) {
              const ins = t.client_insights as Record<string, unknown>;
              if (ins.patterns_observed) clientBlock += `\nPatterns: ${ins.patterns_observed}`;
              if (ins.breakthroughs) clientBlock += `\nBreakthroughs: ${ins.breakthroughs}`;
              if (ins.resistance_points) clientBlock += `\nResistance: ${ins.resistance_points}`;
              if (ins.growth_areas) clientBlock += `\nGrowth areas: ${ins.growth_areas}`;
              if (ins.emotional_state) clientBlock += `\nEmotional state: ${ins.emotional_state}`;
              if (ins.engagement_level) clientBlock += `\nEngagement: ${ins.engagement_level}`;
              if (Array.isArray(ins.language_leaks_observed) && ins.language_leaks_observed.length > 0) {
                clientBlock += `\nLanguage leaks: ${(ins.language_leaks_observed as Array<{ quote: string; leak_type: string; interpretation: string }>).map((l) => `"${l.quote}" (${l.leak_type}: ${l.interpretation})`).join('; ')}`;
              }
            }
            if (t.notable_quotes && Array.isArray(t.notable_quotes) && t.notable_quotes.length > 0) {
              clientBlock += `\nNotable quotes: ${(t.notable_quotes as Array<{ quote: string; context: string; speaker: string }>).map((q) => `"${q.quote}" — ${q.speaker}`).join('; ')}`;
            }
            if (t.recommended_focus_next_session) clientBlock += `\nRecommended focus: ${t.recommended_focus_next_session}`;
          }
        }

        // Recent calendar events
        if (orgEvents && orgEvents.length > 0) {
          clientBlock += `\n\nRecent/upcoming meetings with ${org.name}:
${orgEvents.map((e) => `- ${new Date(e.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${e.subject}`).join('\n')}`;
        }

        contextParts.push(clientBlock);
      } catch (err) {
        console.error(`Failed to fetch deep context for ${org.name}:`, err);
      }
    }

    // ---------------------------------------------------------------
    // Always include recent transcript summaries for general awareness
    // ---------------------------------------------------------------
    const { data: recentTranscripts } = await supabase
      .from('transcripts')
      .select('title, transcript_date, summary, org_id, organizations(name)')
      .eq('is_processed', true)
      .order('transcript_date', { ascending: false })
      .limit(8);

    if (recentTranscripts && recentTranscripts.length > 0) {
      contextParts.push(`RECENT SESSIONS (across all clients):
${recentTranscripts.map((t) => {
  const orgName = (t.organizations as unknown as { name: string } | null)?.name;
  return `- ${t.transcript_date} [${orgName || 'Unknown'}] ${t.title || 'Untitled'}: ${t.summary ? t.summary.substring(0, 150) : 'No summary'}`;
}).join('\n')}`);
    }

    // ---------------------------------------------------------------
    // Text search for transcript-related queries OR when client mentioned
    // ---------------------------------------------------------------
    let ragContext = '';
    const shouldSearchTranscripts = needsRAG(message) || mentionedOrgs.length > 0;
    if (shouldSearchTranscripts) {
      try {
        // Build search terms: include org names + message keywords
        const orgSearchTerms = mentionedOrgs.map((o) => o.name.toLowerCase());
        const messageTerms = message
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 3);
        const allTerms = [...new Set([...orgSearchTerms, ...messageTerms])].slice(0, 8);
        const searchWords = allTerms.join(' | ');

        if (searchWords) {
          const { data: chunks } = await supabase
            .from('transcript_chunks')
            .select('content, metadata, transcript_id, transcripts(title, transcript_date, organizations(name))')
            .textSearch('content', searchWords, { type: 'websearch', config: 'english' })
            .limit(8);

          if (chunks && chunks.length > 0) {
            ragContext = `\nTRANSCRIPT SEARCH RESULTS (verbatim excerpts):
${chunks
  .map((c: Record<string, unknown>) => {
    const transcripts = c.transcripts as Record<string, unknown>[] | Record<string, unknown> | null;
    const t = Array.isArray(transcripts) ? transcripts[0] : transcripts;
    const orgs = t?.organizations as Record<string, unknown>[] | null;
    const orgName = Array.isArray(orgs) ? orgs[0]?.name : (orgs as unknown as Record<string, unknown>)?.name;
    return `[${t?.title || 'Unknown'}, ${t?.transcript_date || 'Unknown'}, ${orgName || 'Unknown'}]: ${(c.content as string).substring(0, 400)}`;
  })
  .join('\n\n')}`;
          } else {
            // Fallback: search by org name if no full-text results
            for (const org of mentionedOrgs) {
              const { data: fallbackChunks } = await supabase
                .from('transcript_chunks')
                .select('content, metadata')
                .ilike('content', `%${org.name}%`)
                .limit(3);

              if (fallbackChunks && fallbackChunks.length > 0) {
                ragContext += `\nTRANSCRIPT EXCERPTS mentioning ${org.name}:
${fallbackChunks.map((c: Record<string, unknown>) => {
  const meta = c.metadata as Record<string, string> | null;
  return `[${meta?.org_name || org.name}, ${meta?.transcript_date || 'Unknown'}]: ${(c.content as string).substring(0, 400)}`;
}).join('\n\n')}`;
              }
            }
          }
        }
      } catch (err) {
        console.error('Transcript search failed (non-fatal):', err);
      }
    }

    // ---------------------------------------------------------------
    // Email search — find emails matching query keywords
    // ---------------------------------------------------------------
    const emailKeywords = ['email', 'emailed', 'wrote', 'sent', 'replied', 'message', 'inbox'];
    const shouldSearchEmails = emailKeywords.some((kw) => message.toLowerCase().includes(kw)) || mentionedOrgs.length > 0;
    if (shouldSearchEmails) {
      try {
        const messageTerms = message
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 3 && !['email', 'emailed', 'about', 'what', 'when', 'from', 'send', 'sent'].includes(w));

        // Search by org if mentioned, otherwise by keywords in subject/body
        let emailSearchResults: Array<Record<string, unknown>> = [];
        for (const org of mentionedOrgs) {
          const { data: orgEmails } = await supabase
            .from('emails')
            .select('subject, sender, sender_email, body_preview, received_at, folder, ai_extraction')
            .eq('org_id', org.id)
            .eq('is_processed', true)
            .order('received_at', { ascending: false })
            .limit(10);
          if (orgEmails) emailSearchResults.push(...orgEmails.map((e) => ({ ...e, _org: org.name })));
        }

        // Also search by keyword in subject if no org match found enough
        if (emailSearchResults.length < 5 && messageTerms.length > 0) {
          for (const term of messageTerms.slice(0, 3)) {
            const { data: keywordEmails } = await supabase
              .from('emails')
              .select('subject, sender, sender_email, body_preview, received_at, folder, ai_extraction')
              .eq('is_processed', true)
              .ilike('subject', `%${term}%`)
              .order('received_at', { ascending: false })
              .limit(5);
            if (keywordEmails) {
              for (const e of keywordEmails) {
                if (!emailSearchResults.some((r) => r.subject === e.subject && r.received_at === e.received_at)) {
                  emailSearchResults.push(e);
                }
              }
            }
          }
        }

        if (emailSearchResults.length > 0) {
          ragContext += `\n\nEMAIL SEARCH RESULTS (${emailSearchResults.length} emails found):
${emailSearchResults.slice(0, 10).map((e) => {
  const extraction = e.ai_extraction as Record<string, unknown> | null;
  const dir = e.folder === 'sent' ? 'SENT' : 'RECEIVED';
  const orgLabel = e._org ? ` [${e._org}]` : '';
  return `[${dir}${orgLabel}] ${e.subject} — ${e.sender} (${(e.received_at as string)?.split('T')[0] || 'unknown'})
  Preview: ${(e.body_preview as string)?.substring(0, 200) || 'No preview'}
  ${extraction?.email_summary ? `AI Summary: ${extraction.email_summary}` : ''}
  ${extraction?.sentiment && extraction.sentiment !== 'neutral' ? `Sentiment: ${extraction.sentiment}` : ''}`;
}).join('\n\n')}`;
        }
      } catch (err) {
        console.error('Email search failed (non-fatal):', err);
      }
    }

    // ---------------------------------------------------------------
    // Commitment search — find commitments matching query
    // ---------------------------------------------------------------
    const commitmentKeywords = ['commitment', 'promised', 'overdue', 'waiting', 'due', 'todo', 'task', 'follow up', 'deliverable'];
    const shouldSearchCommitments = commitmentKeywords.some((kw) => message.toLowerCase().includes(kw)) && !mentionedOrgs.length;
    if (shouldSearchCommitments) {
      try {
        const messageTerms = message
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 3 && !commitmentKeywords.includes(w));

        if (messageTerms.length > 0) {
          for (const term of messageTerms.slice(0, 2)) {
            const { data: matchedCommitments } = await supabase
              .from('commitments')
              .select('id, title, description, commitment_type, owner, status, due_date, org_id, other_party, priority_score')
              .ilike('title', `%${term}%`)
              .order('priority_score', { ascending: false })
              .limit(10);

            if (matchedCommitments && matchedCommitments.length > 0) {
              ragContext += `\n\nCOMMITMENT SEARCH RESULTS for "${term}":
${matchedCommitments.map((c) => `- [id:${c.id}] [${c.owner}] ${c.title} (${c.commitment_type}, ${c.status}${c.due_date ? ', due ' + c.due_date.split('T')[0] : ''}${c.other_party ? ', other: ' + c.other_party : ''})`).join('\n')}`;
            }
          }
        }
      } catch (err) {
        console.error('Commitment search failed (non-fatal):', err);
      }
    }

    // Build system prompt — use Eastern Time for Josh
    const nowET = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const todayStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentTimeET = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const mentionedOrgNames = mentionedOrgs.map((o) => o.name).join(', ');
    const systemPrompt = `You are Command Hub, Josh Wells's AI chief of staff and strategic advisor at LeadShift.
Josh Wells is a Partner and top revenue producer at LeadShift, a leadership development consulting firm founded in 1997. He manages an ~$850K annual book of business across ~60 clients. His work spans executive coaching, leadership academies (Leadership Academy/Elite5, ALIGN), PI behavioral assessments, team workshops (PSL, PUP, DYTT, Change/Tough Conversations), certification (PIPC/DRWT), and fractional advisory roles. His proprietary framework "Language Leaks" (Agency/Identity/Worth lenses) is his distinctive intellectual contribution. Other core frameworks: Signal Model, Predictive Index, Five Dysfunctions of a Team, EQ-i 2.0.

You have FULL ACCESS to Josh's entire database: every commitment, every session transcript (with summaries, themes, language leaks, notable quotes, client insights), every client's health metrics, contacts, calendar events, and recent activity. All of this data is provided below. USE IT. Do not say you lack data or need to search — the data is already in your context.

Josh also uses Command Hub for personal commitments and transcripts. These have category='personal'. Handle these naturally.

Today: ${todayStr}, ${currentTimeET} Eastern Time
${mentionedOrgNames ? `Client(s) mentioned in this message: ${mentionedOrgNames}` : ''}

=== DATA CONTEXT ===
${(() => {
  // Cap total context to ~120k chars (~30k tokens) to stay within model limits
  const MAX_CONTEXT_CHARS = 120000;
  let combined = '';
  for (const part of contextParts) {
    if (combined.length + part.length > MAX_CONTEXT_CHARS) {
      combined += '\n\n[Additional context truncated for size]';
      break;
    }
    combined += (combined ? '\n\n' : '') + part;
  }
  if (ragContext && combined.length + ragContext.length <= MAX_CONTEXT_CHARS) {
    combined += ragContext;
  }
  return combined;
})()}
=== END DATA CONTEXT ===

ACTION SYSTEM:
You are a fully capable chief of staff that can take action on Josh's behalf. When Josh asks you to DO something, return structured JSON. When he asks a QUESTION, respond with plain text using the data above.

When an action is needed, your ENTIRE response must be ONLY the JSON object below — no conversational text before or after it, no markdown fences. Put your conversational response INSIDE the "message" field:
{
  "message": "Your human-readable response explaining what you did or are doing",
  "actions": [
    {"type": "create_commitment", "data": {"title": "...", "org_name": "...", "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep|internal|note_to_self", "due_date": "...", "owner": "josh|other", "description": "..."}},
    {"type": "complete_commitment", "data": {"id": "...", "title": "..."}},
    {"type": "snooze_commitment", "data": {"id": "...", "title": "...", "until": "..."}},
    {"type": "update_commitment", "data": {"id": "...", "title": "...", "updates": {"title": "...", "due_date": "...", "commitment_type": "...", "description": "...", "owner": "...", "org_name": "..."}}},
    {"type": "cancel_commitment", "data": {"id": "...", "title": "..."}},
    {"type": "update_organization", "data": {"name": "...", "updates": {"status": "active|prospect|partner|paused|completed", "strategic_value": "strategic|standard|emerging", "industry": "...", "notes": "..."}}},
    {"type": "create_organization", "data": {"name": "...", "status": "prospect", "strategic_value": "standard", "industry": "..."}},
    {"type": "generate_draft", "data": {"org_name": "...", "draft_type": "follow_up_email|session_summary|proposal_intro|general", "context": "..."}},
    {"type": "generate_briefing", "data": {"org_name": "..."}},
    {"type": "search_transcripts", "data": {"query": "..."}},
    {"type": "search_emails", "data": {"query": "...", "org_name": "optional org filter"}},
    {"type": "get_client_health", "data": {"org_name": "..."}},
    {"type": "get_prep", "data": {"org_name": "..."}},
    {"type": "create_contact", "data": {"org_name": "...", "name": "...", "role": "...", "email": "...", "relationship_type": "champion|decision_maker|influencer|coach|admin|participant", "notes": "..."}},
    {"type": "update_contact", "data": {"name": "...", "org_name": "...", "updates": {"role": "...", "email": "...", "notes": "..."}}},
    {"type": "create_engagement", "data": {"org_name": "...", "name": "Deal or engagement name", "type": "Executive Coaching|Leadership Academy|PSL|PUP|PI Renewal|PIPC|Workshop|Consulting|DYTT|PI License|Other", "value_amount": 15000, "status": "active|completed|pending", "start_date": "2026-04-01", "end_date": "2026-12-31", "notes": "..."}},
    {"type": "update_engagement", "data": {"id": "...", "updates": {"name": "...", "type": "...", "value_amount": 0, "status": "...", "start_date": "...", "end_date": "...", "notes": "..."}}},
    {"type": "update_business_context", "data": {"updates": {"active_priorities": ["new priority list"], "revenue_model.current_quarter.closed": 200000}}},
    {"type": "log_life_event", "data": {"log_type": "workout|habit|family|personal_note", "title": "45 min strength training", "description": "optional details", "tags": ["fitness"], "metadata": {"duration": 45}}},
    {"type": "set_goal", "data": {"title": "Work out 4x/week", "type": "recurring|milestone", "frequency": "weekly|monthly", "target": 4, "tracking_tag": "fitness", "due_date": "for milestones", "milestones": ["Step 1", "Step 2"]}},
    {"type": "update_goal_progress", "data": {"goal_id": "goal-id", "current_milestone": 1, "active": true}},
    {"type": "create_strategic_note", "data": {"title": "Q3 Strategy Plan", "content": "The full strategic analysis or plan...", "tags": ["strategy", "q3"], "org_name": "optional client name"}}
  ]
}

Action guidelines:
- For commitment actions: use the commitment ID from context [id:...] when available, or title for fuzzy matching.
- commitment_type options: promise_made, ask_received, follow_up, waiting_on, deliverable, prep, internal, note_to_self.
- For due_date: use relative terms like "tomorrow", "friday", "next week", "in 3 days" or ISO dates.
- For update_commitment: put changed fields in the "updates" object.
- For update_organization: put changed fields in the "updates" object.
- For generate_draft: include context about what to draft. Use Josh's voice profile for tone.
- For get_client_health: returns follow-through rates, open/overdue counts, session history.
- For get_prep: returns session prep including last recap, open items, provocative question, mood trajectory.
- For create_contact: add a new person to a client org. relationship_type: champion, decision_maker, influencer, coach, admin, participant.
- For update_contact: update a contact's details. Match by name (+ org_name for disambiguation).
- For log_life_event: when Josh says "worked out", "went to gym", "ran 5K", etc. — log it with tags ["fitness"]. For family events use tags ["family"]. For personal notes use log_type "personal_note".
- For set_goal: when Josh says "I want to work out 4 times a week" — create a recurring goal with tracking_tag "fitness" and target 4.
- For update_goal_progress: when Josh says "I finished the outline for Language Leaks" — update the milestone goal's current_milestone.
- For create_strategic_note: when you and Josh work through a plan, strategy, or important analysis together, save it so it persists beyond chat history. Include the full analysis in the content field. Tag with relevant labels (strategy, quarterly, client-name, etc.). These notes appear in your context on future conversations, giving you continuity.
- Always include the "message" field with a human-readable summary.
- Only include "actions" when the user is clearly requesting something be done.
- You can include multiple actions in a single response.
- Use org_id from context when available, fall back to org_name for resolution.

TIME AWARENESS:
Current time: ${currentTimeET} Eastern. Adapt your tone and focus:
- Morning (before 9am): Focus on the day ahead, what to prepare for, energy/personal first
- Work hours (9am-5pm): Focus on client work, meetings, commitments, urgent items
- Evening (after 5pm): Lighter touch, focus on what got done, what's tomorrow, personal check-in
- Weekend: Personal priorities, weekly review, family time. Reduce business urgency.

PERSONAL LIFE AWARENESS:
Josh is not just a consultant — he's a father of two young boys, husband to Katelyn, and someone who values fitness and personal growth. You have his personal goals, habit logs, and personal commitments in your context. When relevant:
- If Josh asks "what should I focus on?" and he hasn't worked out in 3+ days, mention it naturally at the end (not as the main answer during work hours).
- If Josh asks "how am I doing?" answer across ALL three worlds: practice, LeadShift, and personal.
- If Josh mentions a workout, gym session, or exercise — log it as a life event with tags ["fitness"]. Be encouraging.
- If Josh mentions family plans, date nights, kids' events — log as life event with tags ["family"].
- Track his personal goals and mention progress/slippage when asked about his week/month.
- In the evening, proactively ask about personal items if Josh seems to be wrapping up work.

STRATEGIC ADVISOR MODE:
When Josh asks about a client, don't just report data — think strategically:
- Reference the health score, lifecycle stage, and follow-up urgency in the client data above. A client that is "cooling" with high follow-up urgency needs different advice than one that is "thriving" in deep_work.
- What's the revenue trajectory? Growing, flat, or declining?
- What services has this client NOT received that similar clients have? Surface cross-sell opportunities.
- What's the next natural service to offer based on known cross-sell patterns?
- For renewal-only clients, flag that similar clients have expanded to consulting/workshops.

When Josh asks "what should I focus on" or "what's important today/this week", use the PRACTICE SNAPSHOT above and consider:
- Quarterly revenue pace vs target (from practice snapshot)
- Lifecycle distribution — how many clients are at_risk or winding_down?
- Pipeline gaps — months without an anchor deal (Leadership Academy, ALIGN, Fractional)
- High-value clients going cold (14+ days no contact, high follow-up urgency)
- Growth opportunities at expanding clients
- Coaching concentration risks
- Active priorities from the business context

STRUCTURED THINKING FRAMEWORK:
When Josh asks you to "help me think through", "plan", "figure out", or "what's my strategy for" something, use this framework:
1. SITUATION: What does the data actually show? Cite specific numbers, dates, scores, and trends from context. Don't generalize — be precise.
2. IMPLICATIONS: Connect data points. "Client X is winding_down with a health score of 35 AND their renewal is in 60 days, which means..."
3. TRADE-OFFS: What are the competing priorities? "If you invest time re-engaging X, it means less time for Y. Here's why X matters more right now given the $45K revenue at stake..."
4. RECOMMENDATIONS: Ranked by impact. Lead with the #1 action, then alternatives. Include timeframe for each ("this week", "by Friday", "before their renewal in June").
5. WHAT TO WATCH: What signals would change this recommendation? "If they don't respond by Friday, escalate to a call. If the renewal passes without engagement, shift to retention mode."

TIME-HORIZON AWARENESS — layer your advice across these when relevant:
- This week: What's urgent and calendar-driven? What meetings need prep?
- This month: What commitments are due? What renewals are approaching? Who's going cold?
- This quarter: Revenue pace vs target. Pipeline health. Strategic client moves.
- This year: Book of business growth trajectory. Client portfolio balance. Relationship depth evolution.

When creating or discussing engagements, use create_engagement to track deals.
When Josh reports a closed deal or pipeline update, use create_engagement or update_engagement AND update_business_context to keep the living system current.
When you work through a strategic plan or important analysis with Josh, offer to save it using create_strategic_note so it persists beyond chat history. This is especially valuable for quarterly plans, client strategies, and business development approaches.

CRITICAL RULES:
- You have the data. USE IT. When Josh asks "How are things going at MMG?" — you have MMG's transcripts, commitments, contacts, health metrics, and session notes RIGHT HERE in your context. Synthesize and answer directly.
- NEVER say "I don't have enough data" or "I'd need to search" when client data is in your context above.
- NEVER ask Josh to search or point you to data — you already have it.
- Be direct, strategic, and actionable — you're Josh's trusted advisor who knows everything
- If Josh asks "what should I do", give the #1 priority with clear reasoning
- Cite specific data (dates, client names, commitment titles, quotes from sessions) — never be vague
- Reference Josh's frameworks when relevant to coaching advice
- When Josh asks about a client, proactively surface: session insights, open commitments, relationship health, language leaks, patterns, and recommended focus areas
- When discussing sessions, cite specific quotes, themes, and breakthroughs from the transcript data
- When Josh asks you to change/edit something, use the appropriate update action
- Keep responses focused but thorough — give Josh the full picture with specific details from the data`;

    // Build messages for Claude (limit history to last 20 for strategic planning conversations)
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const trimmedHistory = history.slice(-20);
    for (const msg of trimmedHistory) {
      if (!msg.content || !msg.role) continue;
      // Ensure alternating roles — skip if same role as previous
      const lastRole = claudeMessages.length > 0 ? claudeMessages[claudeMessages.length - 1].role : null;
      if (msg.role === lastRole) continue;
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
    // Ensure first message is 'user' (Anthropic requirement)
    while (claudeMessages.length > 0 && claudeMessages[0].role !== 'user') {
      claudeMessages.shift();
    }
    // Remove trailing user message if exists (we'll add the new one)
    while (claudeMessages.length > 0 && claudeMessages[claudeMessages.length - 1].role === 'user') {
      claudeMessages.pop();
    }
    claudeMessages.push({ role: 'user', content: message });

    // Log context size and model for debugging
    const systemLen = systemPrompt.length;
    const msgLen = claudeMessages.reduce((s, m) => s + m.content.length, 0);
    const roles = claudeMessages.map((m) => m.role[0]).join('');
    console.log(`Chat: model=${AI_MODEL}, system=${systemLen}c, msgs=${msgLen}c (${claudeMessages.length} msgs, roles=${roles})`);

    const client = new Anthropic();
    let response;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages: claudeMessages,
      });
    } catch (apiErr) {
      const ae = apiErr as { status?: number; message?: string; error?: { type?: string; message?: string } };
      console.error(`Anthropic API error: status=${ae.status}, type=${ae.error?.type}, msg=${ae.error?.message || ae.message}`);
      throw apiErr;
    }

    const textContent = response.content.find((c) => c.type === 'text');
    const rawReply = textContent && textContent.type === 'text' ? textContent.text : 'I was unable to generate a response.';

    // Parse response for actions
    const structured = parseStructuredResponse(rawReply);

    // Execute actions if any
    let actionResults: ActionResult[] = [];
    if (structured.actions && structured.actions.length > 0) {
      actionResults = await executeActions(
        structured.actions,
        supabase,
        orgList.map((o) => ({ id: o.id, name: o.name })),
        request.url,
      );

      // Append action result confirmations to the message
      const confirmations = actionResults.map((r) => {
        if ((r.type === 'generate_draft' || r.type === 'generate_briefing' || r.type === 'get_prep') && r.success) {
          return `\n\n---\n\n${r.details}`;
        }
        if (r.type === 'search_transcripts' && r.success) {
          return `\n\nTranscript results:\n${r.details}`;
        }
        if (r.type === 'get_client_health' && r.success) {
          return `\n\n**Client Health:**\n${r.details}`;
        }
        if (r.success) {
          return `\n\nDone — ${r.details}`;
        }
        return `\n\nFailed — ${r.details}`;
      });

      structured.message += confirmations.join('');
    }

    return NextResponse.json({
      message: structured.message,
      actions_taken: actionResults.length > 0 ? actionResults : undefined,
      // Backwards compatibility: include response field
      response: structured.message,
    });
  } catch (error) {
    const errObj = error as { status?: number; message?: string; error?: { type?: string; message?: string } };
    const status = errObj.status || 500;
    const errType = errObj.error?.type || 'unknown';
    const errMsg = errObj.error?.message || errObj.message || String(error);
    console.error(`Chat API error [${status}] [${errType}]:`, errMsg);
    return NextResponse.json(
      { error: 'Chat request failed', details: `${errType}: ${errMsg}`.substring(0, 300) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
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
  const ragKeywords = ['session', 'said', 'discussed', 'theme', 'transcript', 'mentioned', 'talked about', 'conversation', 'coaching', 'worried', 'concerned', 'going on', 'happening', 'issues', 'problems'];
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
      .select('id, name, status, strategic_value, industry');

    const orgList = allOrgs || [];

    // Always fetch Josh's voice profile + methodology for deep understanding
    const { data: profileRows } = await supabase
      .from('josh_profile')
      .select('profile_type, profile_data');

    const profileMap: Record<string, unknown> = {};
    for (const row of profileRows || []) {
      profileMap[row.profile_type] = row.profile_data;
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
      .select('id, title, commitment_type, owner, due_date, status, escalation_level, organizations(name)')
      .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
      .order('priority_score', { ascending: false })
      .limit(20);

    if (commitments && commitments.length > 0) {
      const overdueItems = commitments.filter(
        (c) => c.due_date && new Date(c.due_date) < new Date() && c.status !== 'waiting'
      );
      const dueToday = commitments.filter((c) => {
        if (!c.due_date) return false;
        const d = new Date(c.due_date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      });

      contextParts.push(`COMMITMENTS (${commitments.length} open):
Top priorities:
${commitments
  .slice(0, 10)
  .map(
    (c) => {
      const orgArr = c.organizations as unknown as { name: string }[] | null;
      const orgName = orgArr?.[0]?.name;
      return `- [id:${c.id}] [${c.owner === 'josh' ? 'Josh' : 'Other'}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''}${orgName ? ', ' + orgName : ''})`;
    }
  )
  .join('\n')}
${overdueItems.length > 0 ? `\nOVERDUE (${overdueItems.length}): ${overdueItems.map((c) => `${c.title} [id:${c.id}]`).join(', ')}` : ''}
${dueToday.length > 0 ? `\nDUE TODAY (${dueToday.length}): ${dueToday.map((c) => `${c.title} [id:${c.id}]`).join(', ')}` : ''}`);
    }

    // Fetch calendar events with AI analysis (prep notes, event type)
    {
      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const { data: events } = await supabase
        .from('calendar_events')
        .select('subject, start_time, end_time, location, ai_analysis, organizations(name)')
        .gte('start_time', now.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time', { ascending: true })
        .limit(15);

      if (events && events.length > 0) {
        contextParts.push(`UPCOMING CALENDAR (next 7 days):
${events
  .map((e) => {
    const orgArr = e.organizations as unknown as { name: string }[] | null;
    const orgName = orgArr?.[0]?.name;
    const start = new Date(e.start_time);
    const aiData = e.ai_analysis as Record<string, unknown> | null;
    const prepNotes = aiData?.prep_notes ? ` | Prep: ${aiData.prep_notes}` : '';
    const eventType = aiData?.event_type ? ` [${aiData.event_type}]` : '';
    return `- ${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.subject || 'Untitled'}${eventType}${orgName ? ' (' + orgName + ')' : ''}${e.location ? ' @ ' + e.location : ''}${prepNotes}`;
  })
  .join('\n')}`);
      }
    }

    // Always include client list for context
    if (orgList.length > 0) {
      contextParts.push(`ALL CLIENTS:
${orgList.map((o) => `- [id:${o.id}] ${o.name} (${o.status}, ${o.strategic_value}, ${o.industry || 'no industry'})`).join('\n')}`);
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
          return `- ${new Date(e.received_at as string).toLocaleDateString()}: "${e.subject}" from ${e.sender}${orgName ? ' (' + orgName + ')' : ''}${urgency}${sentiment}${topics}${ai?.email_summary ? '\n  Summary: ' + ai.email_summary : ''}`;
        }).join('\n')}`);
      }

      if (sentEmails.length > 0) {
        contextParts.push(`JOSH'S RECENT SENT EMAILS (${sentEmails.length}):
${sentEmails.map((e) => {
          const orgName = e.org_id ? emailOrgMap.get(e.org_id as string) : null;
          const ai = e.ai_extraction as Record<string, unknown> | null;
          return `- ${new Date((e.sent_at || e.received_at) as string).toLocaleDateString()}: "${e.subject}" to ${Array.isArray(e.sender) ? e.sender : 'recipients'}${orgName ? ' (' + orgName + ')' : ''}${ai?.email_summary ? '\n  Summary: ' + ai.email_summary : ''}`;
        }).join('\n')}`);
      }
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
        return `- ${b.briefing_type} briefing (${new Date(b.generated_at).toLocaleDateString()}): ${summary ? JSON.stringify(summary).substring(0, 300) : 'No summary'}`;
      }).join('\n')}`);
    }

    // Include recent activity
    if (recentActivity && recentActivity.length > 0) {
      contextParts.push(`RECENT ACTIVITY (last ${recentActivity.length} actions):
${recentActivity.map((a) => {
        const c = a.commitment as unknown as { title?: string } | null;
        return `- ${a.action}: ${c?.title || 'unknown'} (${new Date(a.created_at).toLocaleDateString()})`;
      }).join('\n')}`);
    }

    // ---------------------------------------------------------------
    // DEEP CLIENT CONTEXT: When a client is mentioned, auto-fetch
    // their full data (transcripts, commitments, contacts, health)
    // ---------------------------------------------------------------
    const mentionedOrgs = detectMentionedOrgs(message, orgList);
    for (const org of mentionedOrgs) {
      try {
        // Fetch org details
        const { data: orgDetail } = await supabase
          .from('organizations')
          .select('name, industry, status, strategic_value, notes')
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

        // Build health metrics
        const openCmts = (orgCommitments || []).filter((c) => ['pending', 'in_progress', 'waiting', 'snoozed'].includes(c.status));
        const overdueCmts = openCmts.filter((c) => c.due_date && new Date(c.due_date) < new Date());
        const completedCmts = (orgCommitments || []).filter((c) => c.status === 'completed');
        const totalCmts = orgCommitments?.length || 0;
        const followThroughRate = totalCmts > 0 ? Math.round((completedCmts.length / totalCmts) * 100) : 0;
        const lastSession = orgTranscripts?.[0];
        const daysSinceContact = lastSession
          ? Math.round((Date.now() - new Date(lastSession.transcript_date).getTime()) / 86400000)
          : null;

        let clientBlock = `\n\nDEEP CLIENT DATA — ${org.name.toUpperCase()}:
Organization: ${orgDetail?.name || org.name} | Status: ${orgDetail?.status} | Strategic value: ${orgDetail?.strategic_value} | Industry: ${orgDetail?.industry || 'Unknown'}
${orgDetail?.notes ? `Notes: ${orgDetail.notes}` : ''}
Health: ${openCmts.length} open commitments (${overdueCmts.length} overdue) | ${completedCmts.length} completed | Follow-through: ${followThroughRate}%
${daysSinceContact !== null ? `Days since last session: ${daysSinceContact}` : 'No sessions recorded'}`;

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
            if (c.relationship_type) clientBlock += ` [${c.relationship_type}]`;
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

    // Build system prompt
    const todayStr = new Date().toISOString().split('T')[0];
    const mentionedOrgNames = mentionedOrgs.map((o) => o.name).join(', ');
    const systemPrompt = `You are Command Hub, Josh Wells's AI chief of staff at LeadShift.
Josh is a leadership development consultant who does sales, coaching, consulting, facilitating, training, and advising for executives and organizations. His core frameworks include Language Leaks (Agency/Identity/Worth), the Signal Model, Predictive Index, Five Dysfunctions of a Team, and EQ-i 2.0.

You have FULL ACCESS to Josh's entire database: every commitment, every session transcript (with summaries, themes, language leaks, notable quotes, client insights), every client's health metrics, contacts, calendar events, and recent activity. All of this data is provided below. USE IT. Do not say you lack data or need to search — the data is already in your context.

Josh also uses Command Hub for personal commitments and transcripts. These have category='personal'. Handle these naturally.

Today's date: ${todayStr}
${mentionedOrgNames ? `Client(s) mentioned in this message: ${mentionedOrgNames}` : ''}

=== DATA CONTEXT ===
${contextParts.join('\n\n')}
${ragContext}
=== END DATA CONTEXT ===

ACTION SYSTEM:
You are a fully capable chief of staff that can take action on Josh's behalf. When Josh asks you to DO something, return structured JSON. When he asks a QUESTION, respond with plain text using the data above.

When an action is needed, return ONLY valid JSON (no markdown fences, no extra text) in this format:
{
  "message": "Your human-readable response explaining what you did or are doing",
  "actions": [
    {"type": "create_commitment", "data": {"title": "...", "org_name": "...", "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep|internal|note_to_self", "due_date": "...", "owner": "josh|other", "description": "..."}},
    {"type": "complete_commitment", "data": {"id": "...", "title": "..."}},
    {"type": "snooze_commitment", "data": {"id": "...", "title": "...", "until": "..."}},
    {"type": "update_commitment", "data": {"id": "...", "title": "...", "updates": {"title": "...", "due_date": "...", "commitment_type": "...", "description": "...", "owner": "..."}}},
    {"type": "cancel_commitment", "data": {"id": "...", "title": "..."}},
    {"type": "update_organization", "data": {"name": "...", "updates": {"status": "active|prospect|partner|paused|completed", "strategic_value": "strategic|standard|emerging", "industry": "...", "notes": "..."}}},
    {"type": "create_organization", "data": {"name": "...", "status": "prospect", "strategic_value": "standard", "industry": "..."}},
    {"type": "generate_draft", "data": {"org_name": "...", "draft_type": "follow_up_email|session_summary|proposal_intro|general", "context": "..."}},
    {"type": "generate_briefing", "data": {"org_name": "..."}},
    {"type": "search_transcripts", "data": {"query": "..."}},
    {"type": "get_client_health", "data": {"org_name": "..."}},
    {"type": "get_prep", "data": {"org_name": "..."}},
    {"type": "create_contact", "data": {"org_name": "...", "name": "...", "role": "...", "email": "...", "relationship_type": "champion|decision_maker|influencer|coach|admin|participant", "notes": "..."}},
    {"type": "update_contact", "data": {"name": "...", "org_name": "...", "updates": {"role": "...", "email": "...", "notes": "..."}}}
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
- Always include the "message" field with a human-readable summary.
- Only include "actions" when the user is clearly requesting something be done.
- You can include multiple actions in a single response.
- Use org_id from context when available, fall back to org_name for resolution.

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

    // Build messages for Claude
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of history) {
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
    claudeMessages.push({ role: 'user', content: message });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages,
    });

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
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 }
    );
  }
}

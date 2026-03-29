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
  const ragKeywords = ['session', 'said', 'discussed', 'theme', 'transcript', 'mentioned', 'talked about', 'conversation', 'coaching'];
  const lower = message.toLowerCase();
  return ragKeywords.some((kw) => lower.includes(kw));
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

  // Try to extract a client name (simple heuristic: word after "with" or quoted text)
  let clientName: string | null = null;
  const withMatch = lower.match(/(?:with|for|about)\s+([a-z][\w\s]*?)(?:\?|$|\.|\s+(?:and|or|but))/);
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
            max_tokens: 2048,
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
            max_tokens: 2048,
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

    // Fetch calendar events if relevant or as default context
    if (intent.fetchCalendar || !intent.fetchCommitments) {
      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const { data: events } = await supabase
        .from('calendar_events')
        .select('subject, start_time, end_time, location, organizations(name)')
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
    return `- ${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.subject || 'Untitled'}${orgName ? ' (' + orgName + ')' : ''}${e.location ? ' @ ' + e.location : ''}`;
  })
  .join('\n')}`);
      }
    }

    // Always include client list for context
    if (orgList.length > 0) {
      contextParts.push(`ALL CLIENTS:
${orgList.map((o) => `- [id:${o.id}] ${o.name} (${o.status}, ${o.strategic_value}, ${o.industry || 'no industry'})`).join('\n')}`);
    }

    // Include Josh's profile context
    if (profileMap['coaching_voice'] || profileMap['writing_style'] || profileMap['priority_patterns']) {
      const frameworks = (profileMap['coaching_voice'] as Record<string, unknown>)?.frameworks_deployed;
      const signature = (profileMap['coaching_voice'] as Record<string, unknown>)?.signature_phrases;
      contextParts.push(`JOSH'S PROFILE:
${frameworks ? `Frameworks Josh uses: ${JSON.stringify(frameworks)}` : ''}
${signature ? `Signature phrases: ${JSON.stringify(signature)}` : ''}
Known frameworks: Language Leaks (Agency/Identity/Worth), Signal Model, Predictive Index, Five Dysfunctions, EQ-i 2.0`);
    }

    // Include recent activity
    if (recentActivity && recentActivity.length > 0) {
      contextParts.push(`RECENT ACTIVITY (last ${recentActivity.length} actions):
${recentActivity.map((a) => {
        const c = a.commitment as unknown as { title?: string } | null;
        return `- ${a.action}: ${c?.title || 'unknown'} (${new Date(a.created_at).toLocaleDateString()})`;
      }).join('\n')}`);
    }

    // Text search for transcript-related queries
    let ragContext = '';
    if (needsRAG(message)) {
      try {
        const searchWords = message
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
          ragContext = `\nTRANSCRIPT CONTEXT (from search):
${chunks
  .map((c: Record<string, unknown>) => {
    const transcripts = c.transcripts as Record<string, unknown>[] | Record<string, unknown> | null;
    const t = Array.isArray(transcripts) ? transcripts[0] : transcripts;
    const orgs = t?.organizations as Record<string, unknown>[] | null;
    return `[${t?.title || 'Unknown'}, ${t?.transcript_date || 'Unknown'}, ${orgs?.[0]?.name || 'Unknown'}]: ${(c.content as string).substring(0, 300)}`;
  })
  .join('\n\n')}`;
        } else {
          // Fallback to ILIKE search
          const { data: fallbackChunks } = await supabase
            .from('transcript_chunks')
            .select('content, metadata')
            .ilike('content', `%${message.split(' ').slice(0, 3).join('%')}%`)
            .limit(5);

          if (fallbackChunks && fallbackChunks.length > 0) {
            ragContext = `\nTRANSCRIPT CONTEXT:
${fallbackChunks.map((c: Record<string, unknown>) => {
  const meta = c.metadata as Record<string, string> | null;
  return `[${meta?.org_name || 'Unknown'}, ${meta?.transcript_date || 'Unknown'}]: ${(c.content as string).substring(0, 300)}`;
}).join('\n\n')}`;
          }
        }
      } catch (err) {
        console.error('Transcript search failed (non-fatal):', err);
      }
    }

    // Build system prompt
    const todayStr = new Date().toISOString().split('T')[0];
    const systemPrompt = `You are Command Hub, Josh Wells's AI chief of staff at LeadShift.
Josh is a leadership development consultant who does sales, coaching, consulting, facilitating, training, and advising for executives and organizations. His core frameworks include Language Leaks (Agency/Identity/Worth), the Signal Model, Predictive Index, Five Dysfunctions of a Team, and EQ-i 2.0.
You have deep access to Josh's commitments, calendar, client data, transcript history, coaching methodology, and voice profile. You know what he's working on, who needs attention, and what happened recently. Answer conversationally but concisely.
Josh also uses Command Hub for personal commitments and transcripts. These have category='personal' and may relate to health, family, finance, home, etc. Handle these naturally — don't try to fit them into a client context.

Today's date: ${todayStr}

Current data context:
${contextParts.join('\n\n')}
${ragContext}

ACTION SYSTEM:
You are a fully capable chief of staff that can take action on Josh's behalf. When Josh asks you to DO something, return structured JSON. When he asks a QUESTION, respond with plain text.

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
    {"type": "get_prep", "data": {"org_name": "..."}}
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
- Always include the "message" field with a human-readable summary.
- Only include "actions" when the user is clearly requesting something be done.
- You can include multiple actions in a single response.
- Use org_id from context when available, fall back to org_name for resolution.

Rules:
- Be direct, strategic, and actionable — you're Josh's trusted advisor
- If Josh asks "what should I do", give the #1 priority with clear reasoning
- Cite specific data (dates, client names, commitment titles) — never be vague
- Reference Josh's frameworks when relevant to coaching advice
- If you don't have enough data, say so honestly
- Keep responses under 200 words unless Josh asks for detail or a draft/briefing is generated
- When Josh asks about a client, proactively surface: open commitments, last session, relationship health
- When Josh asks you to change/edit something, use the appropriate update action`;

    // Build messages for Claude
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of history) {
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
    claudeMessages.push({ role: 'user', content: message });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
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

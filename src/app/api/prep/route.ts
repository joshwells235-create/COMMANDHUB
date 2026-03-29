import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const orgId = request.nextUrl.searchParams.get('org_id');

    if (!orgId) {
      return Response.json(
        { error: 'org_id query parameter is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch everything in parallel for speed
    const [orgRes, transcriptRes, commitmentsRes, contactsRes, sessionComparisonRes] =
      await Promise.all([
        supabase
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .single(),
        supabase
          .from('transcripts')
          .select(
            'transcript_date, summary, key_themes, client_insights, session_arc, notable_quotes, ai_extraction, recommended_focus_next_session'
          )
          .eq('org_id', orgId)
          .eq('is_processed', true)
          .order('transcript_date', { ascending: false })
          .limit(3),
        supabase
          .from('commitments')
          .select('title, commitment_type, owner, due_date, status, priority_score')
          .eq('org_id', orgId)
          .in('status', ['pending', 'in_progress', 'waiting'])
          .order('priority_score', { ascending: false })
          .limit(5),
        supabase
          .from('contacts')
          .select('name, role, relationship_type')
          .eq('org_id', orgId),
        supabase
          .from('transcripts')
          .select('ai_extraction')
          .eq('org_id', orgId)
          .eq('is_processed', true)
          .not('ai_extraction', 'is', null)
          .order('transcript_date', { ascending: false })
          .limit(1),
      ]);

    const org = orgRes.data;
    if (!org) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    const transcripts = transcriptRes.data || [];
    const lastTranscript = transcripts[0] || null;
    const commitments = commitmentsRes.data || [];
    const contacts = contactsRes.data || [];

    // Extract session_comparison from ai_extraction if available
    const aiExtraction = sessionComparisonRes.data?.[0]?.ai_extraction as
      | Record<string, unknown>
      | null;
    const sessionComparison = aiExtraction?.session_comparison || null;

    const contactsList = contacts
      .map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`)
      .join(', ') || 'Unknown';

    const commitmentsList = commitments
      .map(
        (c) =>
          `- [${c.owner === 'josh' ? 'Josh' : 'Client'}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''})`
      )
      .join('\n') || 'None';

    // Build session history from all fetched transcripts
    const sessionHistoryParts = transcripts.map((t, idx) => {
      const themes = t.key_themes;
      const themesStr = Array.isArray(themes)
        ? themes
            .map((th: { theme?: string } | string) =>
              typeof th === 'string' ? th : th.theme || ''
            )
            .filter(Boolean)
            .join(', ')
        : 'None';

      const insights = t.client_insights as {
        patterns_observed?: string;
        resistance_points?: string;
        emotional_state?: string;
        breakthroughs?: string;
        growth_areas?: string;
        language_leaks_observed?: Array<{ quote: string; leak_type: string; interpretation: string }>;
      } | null;

      const quotes = Array.isArray(t.notable_quotes)
        ? (t.notable_quotes as Array<{ quote: string; speaker: string }>).map((q) => `"${q.quote}" — ${q.speaker}`).join('; ')
        : '';

      return `Session ${idx + 1} (${t.transcript_date}):
Summary: ${t.summary || 'No summary'}
${t.session_arc ? `Arc: ${t.session_arc}` : ''}
Themes: ${themesStr}
${insights?.patterns_observed ? `Patterns: ${insights.patterns_observed}` : ''}
${insights?.resistance_points ? `Resistance: ${insights.resistance_points}` : ''}
${insights?.emotional_state ? `Emotional state: ${insights.emotional_state}` : ''}
${insights?.breakthroughs ? `Breakthroughs: ${insights.breakthroughs}` : ''}
${insights?.growth_areas ? `Growth areas: ${insights.growth_areas}` : ''}
${insights?.language_leaks_observed?.length ? `Language leaks: ${insights.language_leaks_observed.map((l) => `"${l.quote}" (${l.leak_type}: ${l.interpretation})`).join('; ')}` : ''}
${quotes ? `Notable quotes: ${quotes}` : ''}
${t.recommended_focus_next_session ? `Recommended focus for next session: ${t.recommended_focus_next_session}` : ''}`;
    });

    const prompt = `You are preparing Josh Wells for a client meeting in 2 minutes. Be concise and direct. You have full access to the session history below.

Client: ${org.name} (${org.industry || 'Unknown industry'})
Contacts: ${contactsList}
Status: ${org.status}, Strategic value: ${org.strategic_value}

${sessionHistoryParts.length > 0 ? `SESSION HISTORY (most recent first):\n${sessionHistoryParts.join('\n\n')}` : 'No previous sessions recorded.'}

${sessionComparison ? `Session-over-session comparison: ${JSON.stringify(sessionComparison)}` : ''}

Open commitments:
${commitmentsList}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "last_session_recap": "2-3 sentences of what happened last time, referencing specific themes and quotes",
  "open_items": ["commitment 1 with owner", "commitment 2 with owner"],
  "what_theyre_avoiding": "one thing the client has been dancing around based on patterns across sessions, or 'Nothing apparent' if unclear",
  "mood_trajectory": "improving" or "stable" or "declining" or "unknown" — based on session-over-session comparison,
  "provocative_question": "one powerful question to ask today, informed by their language leaks and resistance patterns",
  "watch_for": "behavioral cue or pattern to notice today based on historical patterns",
  "relationship_context": "key contacts and their dynamics in one sentence",
  "thread_to_pull": "one theme or breakthrough from recent sessions that deserves deeper exploration today"
}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const prep = JSON.parse(jsonStr);

    return Response.json({
      org_name: org.name,
      org_status: org.status,
      strategic_value: org.strategic_value,
      last_session_date: lastTranscript?.transcript_date || null,
      contacts: contacts.map((c) => ({ name: c.name, role: c.role })),
      prep,
    });
  } catch (error) {
    console.error('Prep generation error:', error);
    return Response.json(
      { error: 'Prep generation failed' },
      { status: 500 }
    );
  }
}

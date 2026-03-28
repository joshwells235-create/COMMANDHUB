import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

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
            'transcript_date, summary, key_themes, client_insights, ai_extraction'
          )
          .eq('org_id', orgId)
          .eq('is_processed', true)
          .order('transcript_date', { ascending: false })
          .limit(1),
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

    const lastTranscript = transcriptRes.data?.[0] || null;
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

    const themes = lastTranscript?.key_themes;
    const themesStr = Array.isArray(themes)
      ? themes
          .map((t: { theme?: string } | string) =>
            typeof t === 'string' ? t : t.theme || ''
          )
          .filter(Boolean)
          .join(', ')
      : 'None';

    const insights = lastTranscript?.client_insights as {
      patterns_observed?: string;
      resistance_points?: string;
      emotional_state?: string;
    } | null;

    const prompt = `You are preparing Josh Wells for a client meeting in 2 minutes. Be concise and direct.

Client: ${org.name} (${org.industry || 'Unknown industry'})
Contacts: ${contactsList}
Status: ${org.status}, Strategic value: ${org.strategic_value}

Last session (${lastTranscript?.transcript_date || 'unknown date'}):
Summary: ${lastTranscript?.summary || 'No previous session data'}
Themes: ${themesStr}
Patterns: ${insights?.patterns_observed || 'None noted'}
Resistance: ${insights?.resistance_points || 'None noted'}
Emotional state: ${insights?.emotional_state || 'Unknown'}
${sessionComparison ? `Session comparison: ${JSON.stringify(sessionComparison)}` : ''}

Open commitments:
${commitmentsList}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "last_session_recap": "2-3 sentences of what happened last time",
  "open_items": ["commitment 1 with owner", "commitment 2 with owner"],
  "what_theyre_avoiding": "one thing the client has been dancing around, or 'Nothing apparent' if unclear",
  "mood_trajectory": "improving" or "stable" or "declining" or "unknown",
  "provocative_question": "one powerful question to ask today",
  "watch_for": "behavioral cue or pattern to notice today",
  "relationship_context": "key contacts and their dynamics in one sentence"
}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
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

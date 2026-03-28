import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let orgId = body.org_id as string | null;
    let sessionDate = body.session_date || null;

    const supabase = createServerClient();

    // If event_id provided, resolve to org_id
    if (body.event_id) {
      const { data: event } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('id', body.event_id)
        .single();

      if (event) {
        orgId = event.org_id;
        sessionDate = event.start_time;
      }
    }

    if (!orgId) {
      return NextResponse.json(
        { error: 'Could not determine organization. Provide org_id or event_id.' },
        { status: 400 }
      );
    }

    // Fetch org details
    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Fetch contacts for this org
    const { data: contacts } = await supabase
      .from('contacts')
      .select('name, role, relationship_type')
      .eq('org_id', orgId);

    // Fetch most recent 3 transcripts
    const { data: recentTranscripts } = await supabase
      .from('transcripts')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_processed', true)
      .order('transcript_date', { ascending: false })
      .limit(3);

    // Fetch open commitments
    const { data: openCommitments } = await supabase
      .from('commitments')
      .select('title, commitment_type, owner, due_date, status')
      .eq('org_id', orgId)
      .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
      .order('priority_score', { ascending: false });

    const lastTranscript = recentTranscripts?.[0] || null;
    const contactNames = (contacts || []).map((c) => c.name).join(', ') || 'Unknown';

    // Aggregate themes from last 3 transcripts
    const aggregatedThemes = (recentTranscripts || [])
      .flatMap((t) => t.key_themes || [])
      .filter((theme: string, index: number, arr: string[]) => arr.indexOf(theme) === index);

    // Extract language leaks from client_insights
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
Session date: ${sessionDate || 'Upcoming'}
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
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    return NextResponse.json({
      briefing: textContent.text,
      org_name: org.name,
      last_session_date: lastTranscript?.transcript_date || null,
    });
  } catch (error) {
    console.error('Briefing generation error:', error);
    return NextResponse.json(
      { error: 'Briefing generation failed' },
      { status: 500 }
    );
  }
}

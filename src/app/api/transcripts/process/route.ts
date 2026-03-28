import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { chunkText } from '@/lib/embeddings';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { transcript_id } = await request.json();
    if (!transcript_id) {
      return NextResponse.json({ error: 'transcript_id required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Fetch the transcript
    const { data: transcript, error: transcriptError } = await supabase
      .from('transcripts')
      .select('*, organizations(name), engagements(name, type)')
      .eq('id', transcript_id)
      .single();

    if (transcriptError || !transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
    }

    // 2. Fetch contacts for context
    const { data: contacts } = await supabase
      .from('contacts')
      .select('name, role')
      .eq('org_id', transcript.org_id);

    const orgName = (transcript.organizations as { name: string } | null)?.name || 'Unknown';
    const engagement = transcript.engagements as { name: string; type: string | null } | null;
    const engagementName = engagement?.name || 'General';
    const engagementType = engagement?.type || 'coaching';
    const participants = Array.isArray(transcript.participants)
      ? transcript.participants.map((p: { name?: string; role?: string }) => `${p.name || 'Unknown'}${p.role ? ` (${p.role})` : ''}`).join(', ')
      : 'Not specified';
    const transcriptDate = transcript.transcript_date || 'Unknown';

    // 3. Call Claude for analysis
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are analyzing a transcript from Josh Wells's consulting practice.
Josh is a leadership development consultant who uses frameworks including
Language Leaks (Avatar vs Source Code, Agency/Identity/Worth lenses),
the Signal Model (antenna/frequency metaphor), Predictive Index behavioral
assessments, Five Dysfunctions of a Team, and EQ-i 2.0.

Organization: ${orgName}
Engagement: ${engagementName} (${engagementType})
Date: ${transcriptDate}
Participants: ${participants}

TRANSCRIPT:
${transcript.raw_text}

Analyze and return JSON only (no markdown code blocks):
{
  "summary": "3-5 sentence executive summary of the session. What was discussed, what shifted, what matters for next time.",
  "key_themes": [
    {
      "theme": "theme name",
      "category": "leadership|communication|team_dynamics|strategy|personal_development|conflict|culture|hiring|performance|delegation|accountability|self_awareness|emotional_intelligence",
      "description": "brief description of how this theme showed up"
    }
  ],
  "commitments": [
    {
      "title": "action item starting with verb",
      "description": "context",
      "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep",
      "owner": "josh|other",
      "other_party": "name if applicable",
      "suggested_due": "ISO date or null",
      "source_quote": "relevant quote from transcript"
    }
  ],
  "client_insights": {
    "patterns_observed": "Recurring behavioral or linguistic patterns",
    "breakthroughs": "Moments of genuine insight or shift",
    "resistance_points": "Where client pushed back or deflected",
    "growth_areas": "What client is working on developing",
    "language_leaks_observed": [
      {
        "quote": "what they said",
        "leak_type": "agency|identity|worth",
        "interpretation": "what this reveals about Avatar vs Source Code"
      }
    ],
    "frameworks_used": ["framework names used in session"],
    "recommended_focus_next_session": "What to explore next time"
  },
  "session_arc": "Where did the session start emotionally/thematically and where did it land? What was the turning point if any?",
  "notable_quotes": [
    {
      "quote": "exact quote",
      "context": "why this quote matters",
      "speaker": "who said it"
    }
  ]
}`,
        },
      ],
    });

    // 4. Parse the AI response
    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const extraction = JSON.parse(jsonStr);

    // 5. Update the transcript record
    await supabase
      .from('transcripts')
      .update({
        summary: extraction.summary,
        key_themes: extraction.key_themes,
        client_insights: extraction.client_insights,
        session_arc: extraction.session_arc,
        notable_quotes: extraction.notable_quotes,
        ai_extraction: extraction,
        review_status: 'pending',
      })
      .eq('id', transcript_id);

    // 6. Chunk the raw text
    const chunks = chunkText(transcript.raw_text);

    // 7. Insert chunks into transcript_chunks (no embeddings - using full-text search)
    const chunkRecords = chunks.map((content, index) => ({
      transcript_id,
      org_id: transcript.org_id,
      chunk_index: index,
      content,
      metadata: {
        transcript_date: transcript.transcript_date,
        transcript_type: transcript.transcript_type,
        org_name: orgName,
        engagement_name: engagementName,
      },
    }));

    // Insert in batches of 20 to avoid payload limits
    for (let i = 0; i < chunkRecords.length; i += 20) {
      const batch = chunkRecords.slice(i, i + 20);
      const { error: chunkError } = await supabase
        .from('transcript_chunks')
        .insert(batch);

      if (chunkError) {
        console.error('Error inserting chunks batch:', chunkError);
      }
    }

    // 9. Create commitments from the extraction
    if (extraction.commitments && extraction.commitments.length > 0) {
      const commitmentRecords = extraction.commitments.map(
        (c: {
          title: string;
          description?: string;
          commitment_type: string;
          owner?: string;
          other_party?: string;
          suggested_due?: string | null;
          source_quote?: string;
        }) => ({
          title: c.title,
          description: c.description || null,
          commitment_type: c.commitment_type,
          org_id: transcript.org_id,
          engagement_id: transcript.engagement_id,
          owner: c.owner || 'josh',
          other_party: c.other_party || null,
          due_date: c.suggested_due || null,
          source_type: 'transcript',
          source_ref: transcript_id,
          source_snippet: c.source_quote || null,
          status: 'pending',
        })
      );

      const { error: commitError } = await supabase
        .from('commitments')
        .insert(commitmentRecords);

      if (commitError) {
        console.error('Error creating commitments:', commitError);
      }
    }

    // 10. Return success with the analysis
    return NextResponse.json({
      success: true,
      transcript_id,
      summary: extraction.summary,
      themes_count: extraction.key_themes?.length || 0,
      commitments_count: extraction.commitments?.length || 0,
      chunks_created: chunks.length,
      extraction,
    });
  } catch (error) {
    console.error('Transcript processing error:', error);
    return NextResponse.json(
      { error: 'Transcript processing failed' },
      { status: 500 }
    );
  }
}

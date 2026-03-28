import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('josh_profile')
      .select('profile_data, updated_at')
      .eq('profile_type', 'coaching_methodology')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'No engagement methodology found. Run a POST to generate one.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      methodology: data.profile_data,
      updated_at: data.updated_at,
    });
  } catch (error) {
    console.error('Methodology retrieval error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve engagement methodology' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const supabase = createServerClient();

    // Fetch all processed transcripts with analysis data
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select(
        'id, title, transcript_type, transcript_date, raw_text, key_themes, client_insights, notable_quotes, participants, org_id, organizations(name)'
      )
      .not('raw_text', 'is', null)
      .order('transcript_date', { ascending: false });

    if (transcriptsError) {
      console.error('Error fetching transcripts:', transcriptsError);
      return NextResponse.json(
        { error: 'Failed to fetch transcripts' },
        { status: 500 }
      );
    }

    if (!transcripts || transcripts.length === 0) {
      return NextResponse.json(
        { error: 'No processed transcripts found to analyze' },
        { status: 400 }
      );
    }

    // Build transcript summaries for the prompt, limiting raw_text to keep within token bounds
    const transcriptSummaries = transcripts
      .map((t, i) => {
        const org =
          (t.organizations as unknown as { name: string } | null)?.name || 'Unknown';
        const participants = Array.isArray(t.participants)
          ? t.participants
              .map(
                (p: { name?: string; role?: string }) =>
                  `${p.name || 'Unknown'}${p.role ? ` (${p.role})` : ''}`
              )
              .join(', ')
          : 'Not specified';

        const themes = Array.isArray(t.key_themes)
          ? t.key_themes
              .map(
                (th: { theme?: string; description?: string }) =>
                  `- ${th.theme || 'Unnamed'}: ${th.description || ''}`
              )
              .join('\n')
          : 'None extracted';

        const insights = t.client_insights
          ? JSON.stringify(t.client_insights, null, 2)
          : 'None extracted';

        const quotes = Array.isArray(t.notable_quotes)
          ? t.notable_quotes
              .map(
                (q: { quote?: string; context?: string; speaker?: string }) =>
                  `"${q.quote || ''}" — ${q.speaker || 'Unknown'} (${q.context || ''})`
              )
              .join('\n')
          : 'None extracted';

        // Limit raw_text to 3000 chars per transcript to stay within prompt limits
        const rawSnippet = t.raw_text ? t.raw_text.slice(0, 3000) : 'No raw text';

        return `=== Transcript ${i + 1}: ${t.title || 'Untitled'} ===
Type: ${t.transcript_type || 'unknown'}
Date: ${t.transcript_date || 'Unknown'}
Organization: ${org}
Participants: ${participants}

KEY THEMES:
${themes}

CLIENT INSIGHTS:
${insights}

NOTABLE QUOTES:
${quotes}

RAW TEXT (excerpt):
${rawSnippet}`;
      })
      .join('\n\n---\n\n');

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are analyzing Josh Wells's engagement methodology across all of his client transcripts. Josh is a leadership development consultant who coaches, facilitates, consults, and advises executives and organizations. Your job is to extract the specific, repeatable patterns that define how Josh works with clients.

Here are ${transcripts.length} transcripts from Josh's client sessions:

${transcriptSummaries}

Analyze all of these transcripts and extract Josh's engagement methodology. Return JSON only (no markdown, no code blocks):
{
  "named_frameworks": [
    {
      "framework_name": "The name Josh uses for this framework or model (or a descriptive name if he doesn't name it explicitly)",
      "description": "How the framework works — what it involves, what it helps clients see or do",
      "how_josh_deploys_it": "When and how Josh typically introduces or uses this framework",
      "sessions_appeared": ["list of transcript titles or dates where this framework appeared"],
      "clients_used_with": ["list of client/org names where this was used"]
    }
  ],
  "signature_questions": [
    {
      "question_pattern": "The core question Josh asks (generalized form)",
      "variants_seen": ["specific versions of this question from different sessions"],
      "what_it_unlocks": "What this question typically leads to — what shift or insight it produces",
      "frequency": "How often this appears across sessions (e.g., 'nearly every session', 'when client is stuck', etc.)"
    }
  ],
  "engagement_sequences": [
    {
      "sequence_name": "A descriptive name for this progression pattern",
      "steps": ["step 1", "step 2", "step 3"],
      "description": "How and when Josh follows this sequence",
      "sessions_observed": ["transcript titles or dates where this sequence was observed"]
    }
  ],
  "intervention_patterns": [
    {
      "situation": "The specific situation type (e.g., 'client resistance', 'deflection with humor', 'breakthrough moment', 'emotional flooding')",
      "josh_response_pattern": "How Josh typically responds in this situation",
      "example_instances": ["brief descriptions of specific instances from the transcripts"],
      "effectiveness_notes": "What tends to happen after Josh uses this intervention"
    }
  ],
  "metaphors_and_analogies": [
    {
      "metaphor": "The metaphor or analogy Josh uses",
      "description": "What it means and what concept it illustrates",
      "when_deployed": "In what situations Josh reaches for this metaphor",
      "sessions_used": ["transcript titles or dates where this appeared"]
    }
  ]
}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr
        .replace(/```json?\n?/g, '')
        .replace(/```$/g, '')
        .trim();
    }
    const methodology = JSON.parse(jsonStr);

    // Upsert into josh_profile table with profile_type = 'coaching_methodology'
    const { error: upsertError } = await supabase.from('josh_profile').upsert(
      {
        profile_type: 'coaching_methodology',
        profile_data: methodology,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_type' }
    );

    if (upsertError) {
      console.error('Error upserting coaching_methodology:', upsertError);
    }

    return NextResponse.json({
      success: true,
      methodology,
      transcripts_analyzed: transcripts.length,
    });
  } catch (error) {
    console.error('Methodology extraction error:', error);
    return NextResponse.json(
      { error: 'Engagement methodology extraction failed' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = createServerClient();

    // Fetch up to 20 most recent processed emails
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('subject, body_preview, sender, sender_email')
      .eq('is_processed', true)
      .order('received_at', { ascending: false })
      .limit(20);

    if (emailsError) {
      console.error('Error fetching emails:', emailsError);
      return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
    }

    // Fetch up to 10 transcripts with raw_text
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select('title, raw_text, transcript_type, summary')
      .order('transcript_date', { ascending: false })
      .limit(10);

    if (transcriptsError) {
      console.error('Error fetching transcripts:', transcriptsError);
      return NextResponse.json({ error: 'Failed to fetch transcripts' }, { status: 500 });
    }

    // Build email samples text
    const emailSamples = (emails || [])
      .map((e, i) => `Email ${i + 1}:\n  Subject: ${e.subject || 'No subject'}\n  From: ${e.sender || 'Unknown'} <${e.sender_email || ''}>\n  Preview: ${(e.body_preview || '').slice(0, 500)}`)
      .join('\n\n');

    // Build transcript samples text (limit raw_text to first 2000 chars each)
    const transcriptSamples = (transcripts || [])
      .map((t, i) => {
        const snippet = t.raw_text ? t.raw_text.slice(0, 2000) : (t.summary || 'No content');
        return `Transcript ${i + 1}: ${t.title || 'Untitled'} (${t.transcript_type || 'unknown type'})\n${snippet}`;
      })
      .join('\n\n---\n\n');

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Analyze Josh Wells's communication across these samples.

EMAILS (samples from Josh's correspondence):
${emailSamples || 'No email samples available'}

SESSION TRANSCRIPTS (samples from Josh's sessions):
${transcriptSamples || 'No transcript samples available'}

Document Josh's communication profile as JSON only (no markdown, no code blocks):
{
  "writing_style": {
    "tone": "how Josh sounds in writing",
    "sentence_structure": "typical patterns",
    "vocabulary_level": "what register does he default to",
    "email_openers": ["typical opening lines"],
    "email_closers": ["typical closing lines"],
    "humor_style": "does he use humor, how",
    "directness": "how direct vs. diplomatic"
  },
  "coaching_voice": {
    "questioning_style": "how he asks questions",
    "challenge_approach": "how he pushes back or challenges",
    "support_approach": "how he validates or encourages",
    "signature_phrases": ["phrases Josh uses regularly"],
    "frameworks_deployed": ["which frameworks he reaches for and when"],
    "metaphor_style": "does he use metaphors, what kind"
  },
  "priority_patterns": {
    "acts_fast_on": "what types of tasks Josh typically completes quickly",
    "tends_to_defer": "what types of tasks Josh typically delays",
    "response_speed_by_client": "which clients get fastest attention",
    "peak_productivity": "patterns in when Josh gets things done"
  }
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
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const profile = JSON.parse(jsonStr);

    // Upsert into josh_profile table: one row per profile_type
    const profileTypes = ['writing_style', 'coaching_voice', 'priority_patterns'] as const;
    for (const profileType of profileTypes) {
      if (profile[profileType]) {
        const { error: upsertError } = await supabase
          .from('josh_profile')
          .upsert(
            {
              profile_type: profileType,
              profile_data: profile[profileType],
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'profile_type' }
          );

        if (upsertError) {
          console.error(`Error upserting ${profileType}:`, upsertError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      profile,
      samples_used: {
        emails: (emails || []).length,
        transcripts: (transcripts || []).length,
      },
    });
  } catch (error) {
    console.error('Voice profile generation error:', error);
    return NextResponse.json(
      { error: 'Voice profile generation failed' },
      { status: 500 }
    );
  }
}

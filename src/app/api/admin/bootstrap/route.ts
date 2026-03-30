import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface BootstrapResults {
  voiceProfile: { success: boolean; error?: string; samples?: { emails: number; transcripts: number }; profileTypes?: string[] };
  methodology: { success: boolean; error?: string; transcriptsAnalyzed?: number };
  emailOrgMatch: { success: boolean; error?: string; matched?: number; total?: number };
  calendarOrgMatch: { success: boolean; error?: string; matched?: number; total?: number };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const results: BootstrapResults = {
    voiceProfile: { success: false },
    methodology: { success: false },
    emailOrgMatch: { success: false },
    calendarOrgMatch: { success: false },
  };

  // ── Section 1: Voice Profile Generation ──────────────────────────────
  try {
    // Fetch up to 20 most recent processed emails
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('subject, body_preview, sender, sender_email')
      .eq('is_processed', true)
      .order('received_at', { ascending: false })
      .limit(20);

    if (emailsError) throw new Error(`Failed to fetch emails: ${emailsError.message}`);

    // Fetch up to 10 transcripts with raw_text
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select('title, raw_text, transcript_type, summary')
      .order('transcript_date', { ascending: false })
      .limit(10);

    if (transcriptsError) throw new Error(`Failed to fetch transcripts: ${transcriptsError.message}`);

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
      model: AI_MODEL,
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
    const upsertedTypes: string[] = [];
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
        } else {
          upsertedTypes.push(profileType);
        }
      }
    }

    results.voiceProfile = {
      success: true,
      samples: {
        emails: (emails || []).length,
        transcripts: (transcripts || []).length,
      },
      profileTypes: upsertedTypes,
    };
  } catch (error) {
    console.error('Voice profile generation error:', error);
    results.voiceProfile = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // ── Section 2: Coaching Methodology Generation ───────────────────────
  try {
    // Fetch all processed transcripts with analysis data
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select(
        'id, title, transcript_type, transcript_date, raw_text, key_themes, client_insights, notable_quotes, participants, org_id, organizations(name)'
      )
      .not('raw_text', 'is', null)
      .order('transcript_date', { ascending: false });

    if (transcriptsError) throw new Error(`Failed to fetch transcripts: ${transcriptsError.message}`);

    if (!transcripts || transcripts.length === 0) {
      throw new Error('No processed transcripts found to analyze');
    }

    // Build transcript summaries for the prompt
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

        // Limit raw_text to 3000 chars per transcript
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
      model: AI_MODEL,
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

    results.methodology = {
      success: true,
      transcriptsAnalyzed: transcripts.length,
    };
  } catch (error) {
    console.error('Methodology extraction error:', error);
    results.methodology = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // ── Section 3: Email Org-Matching Backfill ───────────────────────────
  try {
    // Fetch emails where org_id IS NULL and ai_extraction->>'org_match' IS NOT NULL
    const { data: unmatchedEmails, error: emailsError } = await supabase
      .from('emails')
      .select('id, ai_extraction')
      .is('org_id', null)
      .not('ai_extraction->>org_match', 'is', null);

    if (emailsError) throw new Error(`Failed to fetch unmatched emails: ${emailsError.message}`);

    // Fetch all organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgsError) throw new Error(`Failed to fetch organizations: ${orgsError.message}`);

    let emailsMatched = 0;
    const totalEmails = (unmatchedEmails || []).length;

    if (unmatchedEmails && orgs && orgs.length > 0) {
      for (const email of unmatchedEmails) {
        const orgMatch = (email.ai_extraction as Record<string, unknown>)?.org_match as string | undefined;
        if (!orgMatch) continue;

        const orgMatchLower = orgMatch.toLowerCase();

        // Try exact match first, then contains match
        const matched = orgs.find((org) => {
          const orgNameLower = org.name.toLowerCase();
          return orgNameLower === orgMatchLower
            || orgNameLower.includes(orgMatchLower)
            || orgMatchLower.includes(orgNameLower);
        });

        if (matched) {
          const { error: updateError } = await supabase
            .from('emails')
            .update({ org_id: matched.id })
            .eq('id', email.id);

          if (!updateError) {
            emailsMatched++;
          } else {
            console.error(`Error updating email ${email.id}:`, updateError);
          }
        }
      }
    }

    results.emailOrgMatch = {
      success: true,
      matched: emailsMatched,
      total: totalEmails,
    };
  } catch (error) {
    console.error('Email org-matching error:', error);
    results.emailOrgMatch = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // ── Section 4: Calendar Org-Matching Backfill ────────────────────────
  try {
    // Fetch calendar events where org_id IS NULL
    const { data: unmatchedEventsFiltered, error: eventsFilterError } = await supabase
      .from('calendar_events')
      .select('id, subject, attendees')
      .is('org_id', null);

    if (eventsFilterError) throw new Error(`Failed to fetch unmatched calendar events: ${eventsFilterError.message}`);

    // Fetch contacts with org_id
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id, name, email, org_id');

    if (contactsError) throw new Error(`Failed to fetch contacts: ${contactsError.message}`);

    // Fetch organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgsError) throw new Error(`Failed to fetch organizations: ${orgsError.message}`);

    let eventsMatched = 0;
    const totalEvents = (unmatchedEventsFiltered || []).length;

    if (unmatchedEventsFiltered && contacts && orgs) {
      // Build lookup maps
      const contactsByEmail = new Map<string, string>(); // email -> org_id
      const contactsByName = new Map<string, string>(); // lowercase name -> org_id
      for (const contact of contacts) {
        if (contact.org_id) {
          if (contact.email) {
            contactsByEmail.set(contact.email.toLowerCase(), contact.org_id);
          }
          if (contact.name) {
            contactsByName.set(contact.name.toLowerCase(), contact.org_id);
          }
        }
      }

      for (const event of unmatchedEventsFiltered) {
        let matchedOrgId: string | null = null;

        // Parse attendees - could be array of objects with email/name fields
        const attendees = event.attendees as Array<{ email?: string; name?: string }> | null;

        if (attendees && Array.isArray(attendees)) {
          // Try matching attendee emails against contact emails
          for (const attendee of attendees) {
            if (attendee.email && contactsByEmail.has(attendee.email.toLowerCase())) {
              matchedOrgId = contactsByEmail.get(attendee.email.toLowerCase())!;
              break;
            }
          }

          // Try matching attendee names against contact names
          if (!matchedOrgId) {
            for (const attendee of attendees) {
              if (attendee.name && contactsByName.has(attendee.name.toLowerCase())) {
                matchedOrgId = contactsByName.get(attendee.name.toLowerCase())!;
                break;
              }
            }
          }
        }

        // Try matching event subject against org names (case-insensitive contains)
        if (!matchedOrgId && event.subject) {
          const subjectLower = event.subject.toLowerCase();
          for (const org of orgs) {
            if (subjectLower.includes(org.name.toLowerCase())) {
              matchedOrgId = org.id;
              break;
            }
          }
        }

        if (matchedOrgId) {
          const { error: updateError } = await supabase
            .from('calendar_events')
            .update({ org_id: matchedOrgId })
            .eq('id', event.id);

          if (!updateError) {
            eventsMatched++;
          } else {
            console.error(`Error updating calendar event ${event.id}:`, updateError);
          }
        }
      }
    }

    results.calendarOrgMatch = {
      success: true,
      matched: eventsMatched,
      total: totalEvents,
    };
  } catch (error) {
    console.error('Calendar org-matching error:', error);
    results.calendarOrgMatch = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  return NextResponse.json({
    success: true,
    results,
  });
}

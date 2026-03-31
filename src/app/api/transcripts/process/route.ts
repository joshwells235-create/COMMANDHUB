import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { chunkText } from '@/lib/embeddings';
import { AI_MODEL } from '@/lib/ai';
import Anthropic from '@anthropic-ai/sdk';
import { isSimilarCommitment } from '@/lib/dedup-commitment';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ~150k chars ≈ 40k tokens, leaving room for prompt + response within Sonnet's 200k context
const MAX_TRANSCRIPT_CHARS = 150_000;

function truncateTranscript(text: string): { text: string; wasTruncated: boolean } {
  if (text.length <= MAX_TRANSCRIPT_CHARS) {
    return { text, wasTruncated: false };
  }
  // Keep the beginning and end — most important context is in openings and closings
  const headSize = Math.floor(MAX_TRANSCRIPT_CHARS * 0.6);
  const tailSize = Math.floor(MAX_TRANSCRIPT_CHARS * 0.35);
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  const skippedChars = text.length - headSize - tailSize;
  return {
    text: `${head}\n\n[... ${skippedChars.toLocaleString()} characters omitted for length ...]\n\n${tail}`,
    wasTruncated: true,
  };
}

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

    // 2. Determine if this is a personal or business transcript
    const isPersonal = transcript.category === 'personal' || (!transcript.org_id && !transcript.engagement_id);

    // 3. Fetch contacts and pending commitments for context
    const [contactsRes, pendingCommitmentsRes] = await Promise.all([
      transcript.org_id
        ? supabase.from('contacts').select('name, role').eq('org_id', transcript.org_id)
        : Promise.resolve({ data: null }),
      transcript.org_id
        ? supabase
            .from('commitments')
            .select('id, title, description, commitment_type, owner, other_party, status')
            .eq('org_id', transcript.org_id)
            .in('status', ['pending', 'in_progress', 'waiting'])
            .order('created_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: null }),
    ]);
    const contacts = contactsRes.data;
    const pendingCommitments = pendingCommitmentsRes.data || [];

    const orgName = (transcript.organizations as { name: string } | null)?.name || 'Unknown';
    const engagement = transcript.engagements as { name: string; type: string | null } | null;
    const engagementName = engagement?.name || 'General';
    const engagementType = engagement?.type || 'session';

    // Handle participants as either string[], {name,role}[], or string
    let participantNames: string[] = [];
    if (Array.isArray(transcript.participants)) {
      participantNames = transcript.participants.map((p: string | { name?: string; role?: string }) =>
        typeof p === 'string' ? p : `${p.name || 'Unknown'}${p.role ? ` (${p.role})` : ''}`
      );
    } else if (typeof transcript.participants === 'string') {
      participantNames = transcript.participants.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    const participants = participantNames.length > 0 ? participantNames.join(', ') : 'Not specified';

    // Also fetch known contacts for this org to help with speaker identification
    const contactNames = contacts ? contacts.map((c) => c.name).filter(Boolean) : [];
    const allKnownNames = [...new Set([...participantNames, ...contactNames])].filter(Boolean);

    const transcriptDate = transcript.transcript_date || 'Unknown';
    const personalArea = (transcript.metadata as Record<string, unknown>)?.personal_area || null;

    // 4. Truncate if needed
    const { text: safeText, wasTruncated } = truncateTranscript(transcript.raw_text);
    if (wasTruncated) {
      console.log(`Transcript ${transcript_id} truncated from ${transcript.raw_text.length} to ${safeText.length} chars`);
    }

    // 5. Build the appropriate analysis prompt based on category
    const speakerMapping = allKnownNames.length > 0
      ? `\n\nIMPORTANT — SPEAKER IDENTIFICATION:
The participants in this meeting are: ${allKnownNames.join(', ')}. One of them is always Josh Wells (the consultant/coach).
When the transcript uses generic labels like "Speaker 1", "Speaker 2", "Speaker A", "Speaker B", etc., you MUST identify who each speaker is based on context, what they say, and the participant list above. Use their real names throughout your analysis — NEVER use "Speaker 1" or "Speaker 2" in your output. Josh is typically the one asking questions, coaching, and facilitating.${contactNames.length > 0 ? `\nKnown contacts at ${orgName}: ${contactNames.join(', ')}` : ''}`
      : '';

    const businessPrompt = `You are analyzing a transcript from Josh Wells's consulting practice.
Josh is a leadership development consultant who uses frameworks including
Language Leaks (Avatar vs Source Code, Agency/Identity/Worth lenses),
the Signal Model (antenna/frequency metaphor), Predictive Index behavioral
assessments, Five Dysfunctions of a Team, and EQ-i 2.0.

Organization: ${orgName}
Engagement: ${engagementName} (${engagementType})
Date: ${transcriptDate}
Participants: ${participants}${speakerMapping}

TRANSCRIPT:
${safeText}

COMMITMENT OWNERSHIP RULES — CRITICAL:
When extracting commitments, pay close attention to WHO is taking the action:
- owner="josh" means JOSH needs to take action (Josh promised something, Josh was asked to do something, Josh needs to follow up)
- owner="other" means SOMEONE ELSE promised to do something and Josh should track it as a waiting_on item
- If the CLIENT says "I'll do X", "I will send that", "Let me handle that", "I'll get back to you" → owner="other", commitment_type="waiting_on", other_party=their name
- If JOSH says "I'll send you X", "I will follow up", "Let me prepare that" → owner="josh", commitment_type="promise_made" or "deliverable"
- If Josh ASKS the client to do something ("Can you send me...", "I need you to...") → owner="other", commitment_type="waiting_on"
- If the client ASKS Josh to do something → owner="josh", commitment_type="ask_received"
- Do NOT assign owner="josh" when someone else is the one who needs to act. This is the most common mistake.
- Do NOT create commitments for attending meetings, showing up to calls, or joining sessions. The calendar handles that. Only extract commitments for actual ACTION ITEMS — things to prepare, send, review, create, or follow up on.
- Do NOT create commitments for recurring personal routines (sleep, deep work blocks, exercise, meals, travel logistics). These are calendar context, not actionable tasks.

COMMITMENT QUALITY BAR — BE SELECTIVE:
Only create a commitment if ALL of these are true:
1. Someone made a SPECIFIC, CONCRETE promise or request (not vague intentions like "I should probably..." or "it would be good to...")
2. There is a clear person responsible (Josh or a named other party)
3. It requires actual effort — not just thinking, considering, or keeping something in mind
4. It would genuinely fall through the cracks if not tracked

Do NOT create commitments for:
- Vague intentions ("I need to be better at delegating") — these are growth areas, not action items
- Generic coaching homework ("practice active listening") — too vague to track
- Things Josh will naturally do as part of his normal workflow
- Recurring/ongoing practices ("continue journaling") — not a one-time trackable item

Aim for 0-4 concrete commitments per session, not 6+. Fewer high-quality items are far better than many vague ones.
${pendingCommitments.length > 0 ? `
EXISTING PENDING COMMITMENTS FOR THIS CLIENT (check if any were discussed, completed, or addressed in this session):
${pendingCommitments.map((c: { id: string; title: string; commitment_type: string; owner: string; other_party?: string }) => `- [ID:${c.id}] "${c.title}" (${c.commitment_type}, owner: ${c.owner}${c.other_party ? `, with: ${c.other_party}` : ''})`).join('\n')}

If the transcript shows that any of these existing commitments were completed, delivered, or no longer needed, include their IDs in resolved_commitment_ids. Only mark as resolved if there is clear evidence in the transcript.` : ''}

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
  "resolved_commitment_ids": ["commitment-uuid-1"],
  "session_arc": "Where did the session start emotionally/thematically and where did it land? What was the turning point if any?",
  "notable_quotes": [
    {
      "quote": "exact quote",
      "context": "why this quote matters",
      "speaker": "who said it"
    }
  ]
}`;

    const personalSpeakerMapping = participantNames.length > 0
      ? `\n\nIMPORTANT — SPEAKER IDENTIFICATION:
The participants in this conversation are: ${participantNames.join(', ')}. One of them is Josh Wells.
When the transcript uses generic labels like "Speaker 1", "Speaker 2", etc., you MUST identify who each speaker is and use their real names throughout your analysis — NEVER use "Speaker 1" or "Speaker 2" in your output.`
      : '';

    const personalPrompt = `You are analyzing a personal transcript for Josh Wells.
This is NOT a client or business conversation — it's a personal one${personalArea ? ` related to ${personalArea}` : ''}.
Examples: doctor visit, contractor discussion, family conversation, personal finance meeting, etc.

Date: ${transcriptDate}
Participants: ${participants}${personalSpeakerMapping}

TRANSCRIPT:
${safeText}

COMMITMENT OWNERSHIP RULES — CRITICAL:
When extracting commitments, pay close attention to WHO is taking the action:
- owner="josh" means JOSH needs to take action (Josh promised something, Josh needs to follow up)
- owner="other" means SOMEONE ELSE promised to do something and Josh should track it as a waiting_on item
- If the other person says "I'll do X", "I will send that", "We'll take care of it" → owner="other", commitment_type="waiting_on", other_party=their name
- If JOSH says "I'll handle that", "I will call them", "Let me look into it" → owner="josh", commitment_type="promise_made" or "follow_up"
- Do NOT assign owner="josh" when someone else is the one who needs to act.
- Do NOT create commitments for attending meetings, showing up to appointments, or joining calls. Only extract actual action items.
- Do NOT create commitments for recurring personal routines (sleep, deep work blocks, exercise, meals, travel logistics). These are calendar context, not actionable tasks.

COMMITMENT QUALITY BAR — BE SELECTIVE:
Only create a commitment if someone made a SPECIFIC, CONCRETE promise or request that would genuinely fall through the cracks if not tracked. Skip vague intentions, generic reminders, and things that will naturally happen. Aim for 0-3 commitments per conversation.

Analyze and return JSON only (no markdown code blocks):
{
  "summary": "3-5 sentence summary of the conversation. What was discussed, what decisions were made, what follow-ups are needed.",
  "key_themes": [
    {
      "theme": "theme name",
      "category": "health|family|finance|home|social|legal|travel|personal_development|other",
      "description": "brief description of how this theme showed up"
    }
  ],
  "commitments": [
    {
      "title": "action item starting with verb (e.g. call dentist, schedule contractor, review insurance docs)",
      "description": "context",
      "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep",
      "owner": "josh|other",
      "other_party": "name if applicable",
      "suggested_due": "ISO date or null",
      "source_quote": "relevant quote from transcript"
    }
  ],
  "personal_notes": {
    "key_takeaways": "The most important information or decisions from this conversation",
    "things_to_remember": "Details Josh should remember (medication names, measurements, prices, dates, etc.)",
    "follow_up_needed": "What needs to happen next and who needs to do it",
    "concerns_or_flags": "Anything that seemed concerning or worth monitoring"
  },
  "session_arc": "What was the main purpose of this conversation and what was resolved vs. left open?",
  "notable_quotes": [
    {
      "quote": "exact quote",
      "context": "why this quote matters",
      "speaker": "who said it"
    }
  ]
}`;

    // 5. Call Claude for analysis
    const client = new Anthropic({ timeout: 120_000 }); // 2 min per request
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: isPersonal ? personalPrompt : businessPrompt,
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

    // 5. Session comparison: fetch prior sessions for the same org (business only)
    let sessionComparison = null;
    const { data: priorTranscripts } = !isPersonal && transcript.org_id
      ? await supabase
          .from('transcripts')
          .select('id, transcript_date, summary, key_themes, client_insights, ai_extraction')
          .eq('org_id', transcript.org_id)
          .neq('id', transcript_id)
          .not('ai_extraction', 'is', null)
          .order('transcript_date', { ascending: false })
          .limit(3)
      : { data: null };

    if (priorTranscripts && priorTranscripts.length > 0) {
      const priorSessionsSummary = priorTranscripts.map((pt) => ({
        date: pt.transcript_date,
        summary: pt.summary || (pt.ai_extraction as Record<string, unknown>)?.summary || '',
        themes: pt.key_themes || (pt.ai_extraction as Record<string, unknown>)?.key_themes || [],
        insights: pt.client_insights || (pt.ai_extraction as Record<string, unknown>)?.client_insights || {},
        commitments: (pt.ai_extraction as Record<string, unknown>)?.commitments || [],
      }));

      const comparisonMessage = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `You are analyzing session-over-session progress for a leadership development client.

Organization: ${orgName}
Engagement: ${engagementName} (${engagementType})

CURRENT SESSION (${transcriptDate}):
Summary: ${extraction.summary}
Themes: ${JSON.stringify(extraction.key_themes)}
Insights: ${JSON.stringify(extraction.client_insights)}
Commitments: ${JSON.stringify(extraction.commitments)}

PRIOR SESSIONS (most recent first):
${priorSessionsSummary.map((ps, i) => `--- Session ${i + 1} (${ps.date}) ---
Summary: ${ps.summary}
Themes: ${JSON.stringify(ps.themes)}
Insights: ${JSON.stringify(ps.insights)}
Commitments: ${JSON.stringify(ps.commitments)}`).join('\n\n')}

Compare the current session against the prior sessions. Return JSON only (no markdown code blocks):
{
  "progress_since_last_session": "What changed or improved since the most recent prior session. Be specific about observable shifts.",
  "recurring_themes": [
    {
      "theme": "theme name",
      "frequency": "how many sessions it appeared in",
      "evolution": "how this theme has evolved across sessions"
    }
  ],
  "dropped_commitments": [
    {
      "commitment": "action item from a prior session",
      "original_session_date": "when it was committed to",
      "observation": "why it appears to have been dropped or not addressed"
    }
  ],
  "behavioral_shifts": [
    {
      "area": "what shifted",
      "from": "previous pattern or behavior",
      "to": "current pattern or behavior",
      "significance": "why this matters"
    }
  ],
  "momentum_indicator": {
    "status": "accelerating|steady|stalling|regressing",
    "reasoning": "evidence-based explanation for this assessment"
  }
}`,
          },
        ],
      });

      const compTextContent = comparisonMessage.content.find((c) => c.type === 'text');
      if (compTextContent && compTextContent.type === 'text') {
        let compJsonStr = compTextContent.text.trim();
        if (compJsonStr.startsWith('```')) {
          compJsonStr = compJsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }
        try {
          sessionComparison = JSON.parse(compJsonStr);
        } catch (parseError) {
          console.error('Error parsing session comparison JSON:', parseError);
        }
      }
    }

    // 5b. Merge session_comparison into extraction
    if (sessionComparison) {
      extraction.session_comparison = sessionComparison;
    }

    // 6. Clean up existing data from prior processing (safe reprocess)
    // Delete old commitments sourced from this transcript (cascades to activity)
    const { data: oldCommitments } = await supabase
      .from('commitments')
      .select('id')
      .eq('source_type', 'transcript')
      .eq('source_ref', transcript_id);

    if (oldCommitments && oldCommitments.length > 0) {
      const oldIds = oldCommitments.map((c) => c.id);
      await supabase.from('commitment_activity').delete().in('commitment_id', oldIds);
      await supabase.from('commitments').delete().in('id', oldIds);
    }

    // Delete old transcript chunks
    await supabase.from('transcript_chunks').delete().eq('transcript_id', transcript_id);

    // 6b. Update the transcript record
    await supabase
      .from('transcripts')
      .update({
        summary: extraction.summary,
        key_themes: extraction.key_themes,
        client_insights: isPersonal ? extraction.personal_notes : extraction.client_insights,
        session_arc: extraction.session_arc,
        notable_quotes: extraction.notable_quotes,
        ai_extraction: extraction,
        review_status: 'pending',
        is_processed: true,
      })
      .eq('id', transcript_id);

    // 7. Chunk the raw text
    const chunks = chunkText(transcript.raw_text);

    // 8. Insert chunks into transcript_chunks (no embeddings - using full-text search)
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

    // 8b. Auto-resolve commitments that were addressed in this session
    if (extraction.resolved_commitment_ids?.length > 0) {
      for (const commitmentId of extraction.resolved_commitment_ids) {
        const { data: existing } = await supabase
          .from('commitments')
          .select('id, status')
          .eq('id', commitmentId)
          .in('status', ['pending', 'in_progress', 'waiting'])
          .single();

        if (existing) {
          await supabase
            .from('commitments')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', commitmentId);

          await supabase.from('commitment_activity').insert({
            commitment_id: commitmentId,
            action: 'completed',
            details: {
              source: 'transcript_auto_resolve',
              transcript_id,
              transcript_title: transcript.title,
              description: `Auto-completed: discussed/resolved in session "${transcript.title}" on ${transcriptDate}`,
            },
          });
        }
      }
    }

    // 9. Create commitments from the extraction + log activity (with deduplication)
    if (extraction.commitments && extraction.commitments.length > 0) {
      // Fetch existing active commitments for dedup check
      const { data: existingCommitments } = transcript.org_id
        ? await supabase
            .from('commitments')
            .select('id, title')
            .eq('org_id', transcript.org_id)
            .in('status', ['pending', 'in_progress', 'waiting'])
        : await supabase
            .from('commitments')
            .select('id, title')
            .is('org_id', null)
            .in('status', ['pending', 'in_progress', 'waiting']);

      const existingCommitmentList = existingCommitments || [];

      const dedupedCommitments = extraction.commitments.filter(
        (c: { title: string }) => {
          return !existingCommitmentList.some(
            (existing) => isSimilarCommitment(existing.title, c.title)
          );
        }
      );

      if (dedupedCommitments.length > 0) {
        const commitmentRecords = dedupedCommitments.map(
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
            category: isPersonal ? 'personal' : 'business',
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

        const { data: createdCommitments, error: commitError } = await supabase
          .from('commitments')
          .insert(commitmentRecords)
          .select('id, title');

        if (commitError) {
          console.error('Error creating commitments:', commitError);
        }

        // Log activity for each commitment created from transcript
        if (createdCommitments && createdCommitments.length > 0) {
          const activityRecords = createdCommitments.map((c) => ({
            commitment_id: c.id,
            action: 'created',
            details: {
              title: c.title,
              source: 'transcript',
              transcript_id,
              transcript_title: transcript.title,
            },
          }));
          await supabase.from('commitment_activity').insert(activityRecords);
        }
      }
    }

    // 10. Update org metadata: mark last contact, refresh updated_at
    if (transcript.org_id) {
      const now = new Date().toISOString();
      await supabase
        .from('organizations')
        .update({ updated_at: now })
        .eq('id', transcript.org_id);

      // Update last_interaction_date for all contacts in this org
      await supabase
        .from('contacts')
        .update({ last_interaction_date: now })
        .eq('org_id', transcript.org_id)
        .lt('last_interaction_date', now);
    }

    // 11. Update engagement session tracking if linked
    if (transcript.engagement_id) {
      // Update the engagement's notes with session count
      const { data: engagementTranscripts } = await supabase
        .from('transcripts')
        .select('id')
        .eq('engagement_id', transcript.engagement_id)
        .eq('is_processed', true);

      const sessionCount = engagementTranscripts?.length || 0;
      await supabase
        .from('engagements')
        .update({
          notes: `Sessions: ${sessionCount} | Last session: ${transcript.transcript_date}`,
        })
        .eq('id', transcript.engagement_id);
    }

    // 12. Return success with the analysis
    return NextResponse.json({
      success: true,
      transcript_id,
      summary: extraction.summary,
      themes_count: extraction.key_themes?.length || 0,
      commitments_count: extraction.commitments?.length || 0,
      chunks_created: chunks.length,
      has_session_comparison: sessionComparison !== null,
      extraction,
    });
  } catch (error) {
    console.error('Transcript processing error:', error);
    const message = error instanceof Error ? error.message : 'Transcript processing failed';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

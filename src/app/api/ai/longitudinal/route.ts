import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

    // Fetch org details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return Response.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Fetch all processed transcripts for this org, ordered by date
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('id, transcript_date, summary, key_themes, client_insights, session_arc, notable_quotes, language_leaks_observed, recommended_focus_next_session')
      .eq('org_id', orgId)
      .eq('is_processed', true)
      .order('transcript_date', { ascending: true });

    if (!transcripts || transcripts.length === 0) {
      return Response.json(
        { error: 'No processed transcripts found for this organization' },
        { status: 404 }
      );
    }

    // Fetch all commitments for this org (all statuses)
    const { data: commitments } = await supabase
      .from('commitments')
      .select('id, title, description, commitment_type, owner, other_party, due_date, status, completed_at, source_ref, source_snippet, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    // Fetch contacts for context
    const { data: contacts } = await supabase
      .from('contacts')
      .select('name, role, relationship_type')
      .eq('org_id', orgId);

    const contactNames = (contacts || [])
      .map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`)
      .join(', ') || 'Unknown';

    // Build session history for the prompt
    const sessionHistory = (transcripts || []).map((t, index) => {
      const themes = Array.isArray(t.key_themes)
        ? t.key_themes.map((th: { theme?: string; description?: string } | string) =>
            typeof th === 'string' ? th : `${th.theme}: ${th.description || ''}`
          ).join('; ')
        : 'None recorded';

      const insights = t.client_insights as {
        patterns_observed?: string;
        breakthroughs?: string;
        resistance_points?: string;
        growth_areas?: string;
        recommended_focus_next_session?: string;
      } | null;

      return `SESSION ${index + 1} (${t.transcript_date}):
Summary: ${t.summary || 'No summary'}
Themes: ${themes}
Session Arc: ${t.session_arc || 'Not recorded'}
Patterns: ${insights?.patterns_observed || 'None noted'}
Breakthroughs: ${insights?.breakthroughs || 'None noted'}
Resistance Points: ${insights?.resistance_points || 'None noted'}
Growth Areas: ${insights?.growth_areas || 'None noted'}
Recommended Focus for Next: ${insights?.recommended_focus_next_session || t.recommended_focus_next_session || 'None specified'}`;
    }).join('\n\n---\n\n');

    // Build commitments list
    const commitmentsList = (commitments || []).map((c) => {
      return `- [${c.status.toUpperCase()}] [${c.owner === 'josh' ? 'Josh' : 'Client'}] ${c.title} (${c.commitment_type})${c.due_date ? ` due ${c.due_date}` : ''}${c.completed_at ? ` completed ${c.completed_at}` : ''}${c.source_snippet ? ` | Context: "${c.source_snippet}"` : ''}`;
    }).join('\n');

    const prompt = `You are analyzing the full longitudinal arc of Josh Wells's engagement with a client.
Josh is a leadership development consultant who coaches, facilitates, consults, and advises executives and organizations. He uses frameworks including Language Leaks (Avatar vs Source Code, Agency/Identity/Worth lenses), the Signal Model (antenna/frequency metaphor), Predictive Index behavioral assessments, Five Dysfunctions of a Team, and EQ-i 2.0.

Organization: ${org.name}
Industry: ${org.industry || 'Not specified'}
Strategic Value: ${org.strategic_value}
Engagement Status: ${org.status}
Client Contacts: ${contactNames}
Total Sessions: ${transcripts.length}
Date Range: ${transcripts[0].transcript_date} to ${transcripts[transcripts.length - 1].transcript_date}

=== SESSION HISTORY (chronological) ===

${sessionHistory}

=== ALL COMMITMENTS (chronological) ===

${commitmentsList || 'No commitments recorded'}

Analyze the full trajectory of this engagement and return JSON only (no markdown code blocks):
{
  "commitment_follow_through": {
    "summary": "Overall assessment of commitment follow-through patterns",
    "followed_through": [
      {
        "commitment": "title of commitment",
        "evidence": "how/when it was addressed in subsequent sessions",
        "sessions_referenced": ["session dates where it appeared"]
      }
    ],
    "silently_dropped": [
      {
        "commitment": "title of commitment",
        "originated_session": "date of session where it originated",
        "last_mentioned": "date of last session where it came up, or null if never mentioned again",
        "significance": "why this matters"
      }
    ]
  },
  "theme_evolution": {
    "summary": "2-3 sentence overview of how themes evolved across the engagement",
    "phases": [
      {
        "sessions": "e.g. sessions 1-3",
        "date_range": "start - end date",
        "dominant_themes": ["theme names"],
        "description": "what characterized this phase"
      }
    ],
    "theme_transitions": [
      {
        "from_theme": "theme that faded",
        "to_theme": "theme that emerged",
        "transition_point": "session date or number where shift occurred",
        "catalyst": "what seemed to trigger the shift"
      }
    ]
  },
  "stalled_areas": [
    {
      "topic": "the recurring topic",
      "first_appeared": "session date",
      "recurrence_count": 3,
      "sessions_appeared": ["dates"],
      "pattern": "how it keeps showing up without resolution",
      "possible_reason": "why it might be stalling",
      "suggested_approach": "what Josh might try differently"
    }
  ],
  "growth_trajectory": {
    "summary": "Overall assessment of client growth",
    "areas_of_genuine_progress": [
      {
        "area": "what the client has grown in",
        "evidence": "specific indicators from sessions",
        "trajectory": "early_stage|developing|established"
      }
    ],
    "overall_trajectory": "accelerating|steady|plateauing|regressing"
  },
  "dropped_threads": [
    {
      "thread": "topic or commitment that disappeared",
      "originated_session": "date",
      "context": "what was being discussed",
      "significance": "low|medium|high",
      "recommendation": "whether and how Josh should revisit this"
    }
  ],
  "recommended_interventions": [
    {
      "intervention": "specific thing Josh should bring up or do",
      "rationale": "why this matters based on the trajectory",
      "priority": "high|medium|low",
      "suggested_framing": "how Josh might introduce this in the next session"
    }
  ],
  "engagement_health": {
    "depth_trend": "deepening|stable|superficial",
    "momentum": "strong|moderate|stalling",
    "risk_factors": ["any concerns about the engagement"],
    "bright_spots": ["what is working well"]
  }
}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 8192,
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
    const analysis = JSON.parse(jsonStr);

    // Persist analysis to organization record
    await supabase
      .from('organizations')
      .update({
        intelligence: {
          longitudinal: analysis,
          longitudinal_analyzed_at: new Date().toISOString(),
          total_sessions: transcripts.length,
          date_range: {
            first_session: transcripts[0].transcript_date,
            last_session: transcripts[transcripts.length - 1].transcript_date,
          },
        },
      })
      .eq('id', orgId);

    return Response.json({
      org_id: orgId,
      org_name: org.name,
      total_sessions: transcripts.length,
      date_range: {
        first_session: transcripts[0].transcript_date,
        last_session: transcripts[transcripts.length - 1].transcript_date,
      },
      total_commitments: (commitments || []).length,
      analysis,
    });
  } catch (error) {
    console.error('Longitudinal analysis error:', error);
    return Response.json(
      { error: 'Longitudinal analysis failed' },
      { status: 500 }
    );
  }
}

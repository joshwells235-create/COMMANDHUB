import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: profile, error } = await supabase
      .from('josh_profile')
      .select('profile_data, updated_at')
      .eq('profile_type', 'cross_client_patterns')
      .single();

    if (error || !profile) {
      return NextResponse.json(
        { error: 'No cross-client patterns found. Run POST to generate.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      patterns: profile.profile_data,
      generated_at: profile.updated_at,
    });
  } catch (error) {
    console.error('Error fetching cross-client patterns:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cross-client patterns' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const supabase = createServerClient();

    // Fetch all processed transcripts with their org info
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select(
        'id, title, transcript_date, transcript_type, summary, key_themes, client_insights, session_arc, ai_extraction, org_id, organizations(id, name, industry, status, strategic_value)'
      )
      .eq('is_processed', true)
      .not('ai_extraction', 'is', null)
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
        { error: 'No processed transcripts found. Process some transcripts first.' },
        { status: 400 }
      );
    }

    // Group transcripts by organization for the prompt
    const orgMap = new Map<
      string,
      {
        org: { id: string; name: string; industry: string | null; status: string | null; strategic_value: string | null };
        sessions: typeof transcripts;
      }
    >();

    for (const t of transcripts) {
      const org = t.organizations as unknown as { id: string; name: string; industry: string | null; status: string | null; strategic_value: string | null } | null;
      const orgId = t.org_id;
      if (!orgId || !org) continue;

      if (!orgMap.has(orgId)) {
        orgMap.set(orgId, { org, sessions: [] });
      }
      orgMap.get(orgId)!.sessions.push(t);
    }

    // Build the per-client summaries for the prompt
    const clientSummaries = Array.from(orgMap.values())
      .map(({ org, sessions }) => {
        const themes = sessions
          .flatMap((s) => {
            if (!s.key_themes) return [];
            if (Array.isArray(s.key_themes)) {
              return s.key_themes.map((th: { theme?: string; category?: string; description?: string } | string) =>
                typeof th === 'string' ? th : `${th.theme || 'Unknown'} (${th.category || 'uncategorized'}): ${th.description || ''}`
              );
            }
            return [];
          })
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

        const insights = sessions
          .map((s) => {
            if (!s.client_insights) return null;
            const ci = s.client_insights as {
              patterns_observed?: string;
              breakthroughs?: string;
              resistance_points?: string;
              growth_areas?: string;
              frameworks_used?: string[];
              recommended_focus_next_session?: string;
            };
            return [
              ci.patterns_observed ? `Patterns: ${ci.patterns_observed}` : null,
              ci.breakthroughs ? `Breakthroughs: ${ci.breakthroughs}` : null,
              ci.resistance_points ? `Resistance: ${ci.resistance_points}` : null,
              ci.growth_areas ? `Growth areas: ${ci.growth_areas}` : null,
              ci.frameworks_used?.length ? `Frameworks used: ${ci.frameworks_used.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join('\n    ');
          })
          .filter(Boolean);

        const sessionSummaries = sessions
          .slice(0, 5) // limit to 5 most recent per client
          .map(
            (s) =>
              `  - ${s.transcript_date || 'Unknown date'}: ${s.summary || 'No summary'}`
          )
          .join('\n');

        return `CLIENT: ${org.name}
  Industry: ${org.industry || 'Not specified'}
  Status: ${org.status || 'Unknown'}
  Strategic value: ${org.strategic_value || 'Unknown'}
  Sessions analyzed: ${sessions.length}

  Recent session summaries:
${sessionSummaries}

  Key themes across sessions:
    ${themes.length > 0 ? themes.join('\n    ') : 'None recorded'}

  Client insights:
    ${insights.length > 0 ? insights.join('\n    ---\n    ') : 'None recorded'}`;
      })
      .join('\n\n---\n\n');

    const prompt = `You are analyzing Josh Wells's entire leadership development practice across all clients.
Josh is a leadership development consultant who coaches, facilitates, consults, and advises executives and organizations. He uses frameworks including
Language Leaks (Avatar vs Source Code, Agency/Identity/Worth lenses),
the Signal Model (antenna/frequency metaphor), Predictive Index behavioral
assessments, Five Dysfunctions of a Team, and EQ-i 2.0.

Below is data from ${transcripts.length} sessions across ${orgMap.size} clients.

${clientSummaries}

Analyze patterns across ALL clients and return JSON only (no markdown, no code blocks):
{
  "cross_client_patterns": [
    {
      "pattern": "name of the pattern",
      "description": "what the pattern is",
      "clients_affected": ["client names showing this pattern"],
      "frequency": "how common this is (e.g., '4 of 6 clients')",
      "significance": "why this matters for Josh's practice"
    }
  ],
  "what_worked_where": [
    {
      "challenge": "the challenge or pattern that was addressed",
      "client_resolved": "client name where this was resolved or improved",
      "approach_used": "what Josh did that worked",
      "applicable_to": ["other client names facing similar challenges"],
      "suggested_adaptation": "how Josh could adapt this approach for the other clients"
    }
  ],
  "coaching_blind_spots": [
    {
      "blind_spot": "theme or area Josh consistently misses or defers",
      "evidence": "what in the data suggests this",
      "impact": "what this might cost clients",
      "recommendation": "what Josh could do differently"
    }
  ],
  "client_archetypes": [
    {
      "archetype_name": "descriptive name for this group",
      "description": "what defines this archetype",
      "clients": ["client names in this group"],
      "shared_characteristics": ["list of shared traits or challenges"],
      "recommended_approach": "how Josh might approach this archetype"
    }
  ]
}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
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
    const patterns = JSON.parse(jsonStr);

    // Store results in josh_profile table
    const { error: upsertError } = await supabase
      .from('josh_profile')
      .upsert(
        {
          profile_type: 'cross_client_patterns',
          profile_data: patterns,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_type' }
      );

    if (upsertError) {
      console.error('Error upserting cross_client_patterns:', upsertError);
    }

    return NextResponse.json({
      success: true,
      patterns,
      metadata: {
        clients_analyzed: orgMap.size,
        transcripts_analyzed: transcripts.length,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Cross-client pattern analysis error:', error);
    return NextResponse.json(
      { error: 'Cross-client pattern analysis failed' },
      { status: 500 }
    );
  }
}

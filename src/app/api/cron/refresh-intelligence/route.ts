import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: {
    theme_alerts: { success: boolean; error?: string; metadata?: Record<string, unknown> };
    cross_client: { success: boolean; error?: string; metadata?: Record<string, unknown> };
  } = {
    theme_alerts: { success: false },
    cross_client: { success: false },
  };

  const supabase = createServerClient();
  const client = new Anthropic();

  // ── 1. Theme Alerts Refresh ──────────────────────────────────────────────

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: themeTranscripts, error: themeTranscriptsError } = await supabase
      .from('transcripts')
      .select(
        'id, title, transcript_date, key_themes, client_insights, org_id, organizations(id, name)'
      )
      .eq('is_processed', true)
      .gte('transcript_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('transcript_date', { ascending: false });

    if (themeTranscriptsError) {
      results.theme_alerts = { success: false, error: `Fetch error: ${themeTranscriptsError.message}` };
    } else if (!themeTranscripts || themeTranscripts.length < 3) {
      // Not enough data — store empty result
      await supabase
        .from('josh_profile')
        .upsert(
          {
            profile_type: 'theme_alerts',
            profile_data: { themes: [], coaching_opportunity: null, blind_spot_alert: null },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_type' }
        );
      results.theme_alerts = {
        success: true,
        metadata: { transcripts_analyzed: themeTranscripts?.length || 0, not_enough_data: true },
      };
    } else {
      // Group by org
      const orgMap = new Map<
        string,
        { org: { id: string; name: string }; themes: string[]; insights: string[] }
      >();

      for (const t of themeTranscripts) {
        const org = t.organizations as unknown as { id: string; name: string } | null;
        const orgId = t.org_id;
        if (!orgId || !org) continue;

        if (!orgMap.has(orgId)) {
          orgMap.set(orgId, { org, themes: [], insights: [] });
        }

        const entry = orgMap.get(orgId)!;

        if (Array.isArray(t.key_themes)) {
          for (const th of t.key_themes) {
            const themeStr =
              typeof th === 'string'
                ? th
                : `${(th as { theme?: string }).theme || 'Unknown'} (${(th as { category?: string }).category || 'uncategorized'}): ${(th as { description?: string }).description || ''}`;
            entry.themes.push(themeStr);
          }
        }

        if (t.client_insights) {
          const ci = t.client_insights as {
            patterns_observed?: string;
            breakthroughs?: string;
            resistance_points?: string;
            growth_areas?: string;
          };
          const parts = [
            ci.patterns_observed ? `Patterns: ${ci.patterns_observed}` : null,
            ci.breakthroughs ? `Breakthroughs: ${ci.breakthroughs}` : null,
            ci.resistance_points ? `Resistance: ${ci.resistance_points}` : null,
            ci.growth_areas ? `Growth areas: ${ci.growth_areas}` : null,
          ].filter(Boolean);
          if (parts.length > 0) {
            entry.insights.push(parts.join('; '));
          }
        }
      }

      const clientSummaries = Array.from(orgMap.values())
        .map(
          ({ org, themes, insights }) =>
            `CLIENT: ${org.name} (org_id: ${org.id})
  Themes: ${themes.length > 0 ? themes.join(', ') : 'None'}
  Insights: ${insights.length > 0 ? insights.join(' | ') : 'None'}`
        )
        .join('\n\n');

      const themePrompt = `You are analyzing recurring themes across Josh Wells's leadership development clients from the last 30 days.
Josh is a leadership development consultant who coaches, facilitates, consults, and advises executives and organizations.

Below is data from ${themeTranscripts.length} sessions across ${orgMap.size} clients in the last 30 days.

${clientSummaries}

Identify themes that appear across 3 or more different clients. For each theme, assess its severity.

Return JSON only (no markdown, no code blocks):
{
  "themes": [
    {
      "theme": "name of the recurring theme (e.g., 'conflict avoidance', 'delegation struggles')",
      "description": "what the pattern is across clients",
      "clients_affected": [{"org_id": "the org id", "org_name": "the org name"}],
      "frequency": number of times this theme appeared across all sessions,
      "opportunity": "what Josh could do about it (e.g., 'Consider a group workshop on difficult conversations')",
      "severity": "trend|pattern|urgent"
    }
  ],
  "coaching_opportunity": "A specific offering Josh could package as a workshop or group program based on these themes, or null if nothing stands out",
  "blind_spot_alert": "A theme Josh might be under-addressing across his practice, or null if nothing stands out"
}

Severity definitions:
- "trend": emerging theme, appeared recently in 3+ clients
- "pattern": established theme, recurring consistently
- "urgent": needs immediate attention, clients are stuck or regressing

Sort the themes array by severity: urgent first, then pattern, then trend.
Only include themes that genuinely appear across 3+ different clients. If fewer than 3 clients share any theme, return an empty themes array.`;

      const themeMessage = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: themePrompt }],
      });

      const themeTextContent = themeMessage.content.find((c) => c.type === 'text');
      if (!themeTextContent || themeTextContent.type !== 'text') {
        throw new Error('No AI response received for theme alerts');
      }

      let themeJsonStr = themeTextContent.text.trim();
      if (themeJsonStr.startsWith('```')) {
        themeJsonStr = themeJsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
      }
      const alerts = JSON.parse(themeJsonStr);

      const { error: themeUpsertError } = await supabase
        .from('josh_profile')
        .upsert(
          {
            profile_type: 'theme_alerts',
            profile_data: alerts,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_type' }
        );

      if (themeUpsertError) {
        console.error('Error upserting theme_alerts:', themeUpsertError);
      }

      results.theme_alerts = {
        success: true,
        metadata: {
          clients_analyzed: orgMap.size,
          transcripts_analyzed: themeTranscripts.length,
        },
      };
    }
  } catch (error) {
    console.error('Theme alerts refresh error:', error);
    results.theme_alerts = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // ── 2. Cross-Client Patterns Refresh ─────────────────────────────────────

  try {
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('transcripts')
      .select(
        'id, title, transcript_date, transcript_type, summary, key_themes, client_insights, session_arc, ai_extraction, org_id, organizations(id, name, industry, status, strategic_value)'
      )
      .eq('is_processed', true)
      .not('ai_extraction', 'is', null)
      .order('transcript_date', { ascending: false });

    if (transcriptsError) {
      results.cross_client = { success: false, error: `Fetch error: ${transcriptsError.message}` };
    } else if (!transcripts || transcripts.length === 0) {
      results.cross_client = { success: false, error: 'No processed transcripts found' };
    } else {
      const orgMap = new Map<
        string,
        {
          org: {
            id: string;
            name: string;
            industry: string | null;
            status: string | null;
            strategic_value: string | null;
          };
          sessions: typeof transcripts;
        }
      >();

      for (const t of transcripts) {
        const org = t.organizations as unknown as {
          id: string;
          name: string;
          industry: string | null;
          status: string | null;
          strategic_value: string | null;
        } | null;
        const orgId = t.org_id;
        if (!orgId || !org) continue;

        if (!orgMap.has(orgId)) {
          orgMap.set(orgId, { org, sessions: [] });
        }
        orgMap.get(orgId)!.sessions.push(t);
      }

      const clientSummaries = Array.from(orgMap.values())
        .map(({ org, sessions }) => {
          const themes = sessions
            .flatMap((s) => {
              if (!s.key_themes) return [];
              if (Array.isArray(s.key_themes)) {
                return s.key_themes.map(
                  (th: { theme?: string; category?: string; description?: string } | string) =>
                    typeof th === 'string'
                      ? th
                      : `${th.theme || 'Unknown'} (${th.category || 'uncategorized'}): ${th.description || ''}`
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
                ci.frameworks_used?.length
                  ? `Frameworks used: ${ci.frameworks_used.join(', ')}`
                  : null,
              ]
                .filter(Boolean)
                .join('\n    ');
            })
            .filter(Boolean);

          const sessionSummaries = sessions
            .slice(0, 5)
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

      const crossClientPrompt = `You are analyzing Josh Wells's entire leadership development practice across all clients.
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

      const crossClientMessage = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: crossClientPrompt }],
      });

      const crossClientTextContent = crossClientMessage.content.find((c) => c.type === 'text');
      if (!crossClientTextContent || crossClientTextContent.type !== 'text') {
        throw new Error('No AI response received for cross-client patterns');
      }

      let crossClientJsonStr = crossClientTextContent.text.trim();
      if (crossClientJsonStr.startsWith('```')) {
        crossClientJsonStr = crossClientJsonStr
          .replace(/```json?\n?/g, '')
          .replace(/```$/g, '')
          .trim();
      }
      const patterns = JSON.parse(crossClientJsonStr);

      const { error: crossClientUpsertError } = await supabase
        .from('josh_profile')
        .upsert(
          {
            profile_type: 'cross_client_patterns',
            profile_data: patterns,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_type' }
        );

      if (crossClientUpsertError) {
        console.error('Error upserting cross_client_patterns:', crossClientUpsertError);
      }

      results.cross_client = {
        success: true,
        metadata: {
          clients_analyzed: orgMap.size,
          transcripts_analyzed: transcripts.length,
        },
      };
    }
  } catch (error) {
    console.error('Cross-client patterns refresh error:', error);
    results.cross_client = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // ── Return Results ───────────────────────────────────────────────────────

  const allSucceeded = results.theme_alerts.success && results.cross_client.success;

  return NextResponse.json(
    {
      success: allSucceeded,
      refreshed_at: new Date().toISOString(),
      results,
    },
    { status: allSucceeded ? 200 : 207 }
  );
}

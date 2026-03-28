import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const supabase = createServerClient();

    // First try to return cached results
    const { data: cached, error: cacheError } = await supabase
      .from('josh_profile')
      .select('profile_data, updated_at')
      .eq('profile_type', 'theme_alerts')
      .single();

    if (!cacheError && cached) {
      return NextResponse.json({
        alerts: cached.profile_data,
        generated_at: cached.updated_at,
      });
    }

    // No cached data — generate fresh
    return await generateThemeAlerts();
  } catch (error) {
    console.error('Error fetching theme alerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch theme alerts' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    return await generateThemeAlerts();
  } catch (error) {
    console.error('Theme alerts generation error:', error);
    return NextResponse.json(
      { error: 'Theme alerts generation failed' },
      { status: 500 }
    );
  }
}

async function generateThemeAlerts() {
  const supabase = createServerClient();

  // Fetch transcripts from the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: transcripts, error: transcriptsError } = await supabase
    .from('transcripts')
    .select(
      'id, title, transcript_date, key_themes, client_insights, org_id, organizations(id, name)'
    )
    .eq('is_processed', true)
    .gte('transcript_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('transcript_date', { ascending: false });

  if (transcriptsError) {
    console.error('Error fetching transcripts:', transcriptsError);
    return NextResponse.json(
      { error: 'Failed to fetch transcripts' },
      { status: 500 }
    );
  }

  if (!transcripts || transcripts.length < 3) {
    return NextResponse.json({
      alerts: {
        themes: [],
        coaching_opportunity: null,
        blind_spot_alert: null,
      },
      generated_at: new Date().toISOString(),
      metadata: { transcripts_analyzed: transcripts?.length || 0, not_enough_data: true },
    });
  }

  // Group by org and build summaries
  const orgMap = new Map<
    string,
    {
      org: { id: string; name: string };
      themes: string[];
      insights: string[];
    }
  >();

  for (const t of transcripts) {
    const org = t.organizations as unknown as { id: string; name: string } | null;
    const orgId = t.org_id;
    if (!orgId || !org) continue;

    if (!orgMap.has(orgId)) {
      orgMap.set(orgId, { org, themes: [], insights: [] });
    }

    const entry = orgMap.get(orgId)!;

    // Collect themes
    if (Array.isArray(t.key_themes)) {
      for (const th of t.key_themes) {
        const themeStr =
          typeof th === 'string'
            ? th
            : `${(th as { theme?: string }).theme || 'Unknown'} (${(th as { category?: string }).category || 'uncategorized'}): ${(th as { description?: string }).description || ''}`;
        entry.themes.push(themeStr);
      }
    }

    // Collect insights
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

  // Build prompt data
  const clientSummaries = Array.from(orgMap.values())
    .map(
      ({ org, themes, insights }) =>
        `CLIENT: ${org.name} (org_id: ${org.id})
  Themes: ${themes.length > 0 ? themes.join(', ') : 'None'}
  Insights: ${insights.length > 0 ? insights.join(' | ') : 'None'}`
    )
    .join('\n\n');

  const prompt = `You are analyzing recurring themes across Josh Wells's leadership development clients from the last 30 days.
Josh is a leadership development consultant who coaches, facilitates, consults, and advises executives and organizations.

Below is data from ${transcripts.length} sessions across ${orgMap.size} clients in the last 30 days.

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

  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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
  const alerts = JSON.parse(jsonStr);

  // Store in josh_profile
  const { error: upsertError } = await supabase
    .from('josh_profile')
    .upsert(
      {
        profile_type: 'theme_alerts',
        profile_data: alerts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_type' }
    );

  if (upsertError) {
    console.error('Error upserting theme_alerts:', upsertError);
  }

  return NextResponse.json({
    alerts,
    generated_at: new Date().toISOString(),
    metadata: {
      clients_analyzed: orgMap.size,
      transcripts_analyzed: transcripts.length,
    },
  });
}

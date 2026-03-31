import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = createServerClient();

    // Query commitment_activity for the last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: activities } = await supabase
      .from('commitment_activity')
      .select('commitment_id, action, details, created_at')
      .gte('created_at', ninetyDaysAgo.toISOString())
      .in('action', ['completed', 'snoozed', 'cancelled', 'deferred']);

    if (!activities || activities.length < 5) {
      return NextResponse.json({
        last_run: new Date().toISOString(),
        insights: ['Not enough activity data yet. Need at least 5 completed/snoozed/cancelled items to learn patterns.'],
        modifier_rules: [],
      });
    }

    // Fetch the commitments involved
    const commitmentIds = [...new Set(activities.map((a) => a.commitment_id))];
    const { data: commitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, owner, priority_score, org_id, due_date, created_at, completed_at')
      .in('id', commitmentIds.slice(0, 200));

    // Build analysis text
    const activityText = activities.map((a) => {
      const c = commitments?.find((cm) => cm.id === a.commitment_id);
      return `Action: ${a.action} | Title: ${c?.title || 'Unknown'} | Type: ${c?.commitment_type || '?'} | Owner: ${c?.owner || '?'} | Priority: ${c?.priority_score || '?'} | Date: ${a.created_at}`;
    }).join('\n');

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Analyze Josh Wells' commitment handling patterns from the last 90 days. Josh is a leadership development consultant.

ACTIVITY DATA (${activities.length} actions):
${activityText}

Based on these patterns, provide:
1. "insights" - 3-5 key observations about Josh's priority behavior (what gets done fast vs. sits, what gets snoozed, patterns by type/owner)
2. "modifier_rules" - 2-4 concrete rules for adjusting AI priority scores, each with:
   - "rule": human-readable description
   - "modifier": integer adjustment (-10 to +10)

Respond in JSON format:
{
  "insights": ["insight1", "insight2"],
  "modifier_rules": [{"rule": "description", "modifier": 5}]
}`,
      }],
    });

    const text = message.content.find((c) => c.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('No AI response');
    }

    let parsed;
    try {
      const jsonMatch = text.text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { insights: [], modifier_rules: [] };
    } catch {
      parsed = { insights: [text.text], modifier_rules: [] };
    }

    // Save to josh_profile
    await supabase
      .from('josh_profile')
      .upsert({
        profile_type: 'priority_patterns_insights',
        profile_data: parsed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_type' });

    return NextResponse.json({
      last_run: new Date().toISOString(),
      ...parsed,
    });
  } catch (error) {
    console.error('Priority learning error:', error);
    return NextResponse.json({ error: 'Failed to run priority learning' }, { status: 500 });
  }
}

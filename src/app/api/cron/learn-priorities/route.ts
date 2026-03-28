import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();

    // Query commitment_activity for the last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const sinceDate = ninetyDaysAgo.toISOString();

    const { data: activities, error: activitiesError } = await supabase
      .from('commitment_activity')
      .select('commitment_id, action, details, created_at')
      .gte('created_at', sinceDate)
      .in('action', ['completed', 'snoozed', 'cancelled', 'deferred']);

    if (activitiesError) {
      console.error('Error fetching activities:', activitiesError);
      return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
    }

    if (!activities || activities.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No activity data in the last 90 days to analyze',
        modifiers: [],
        insights: [],
      });
    }

    // Fetch related commitments with org data for all activity commitment_ids
    const commitmentIds = [...new Set(activities.map((a) => a.commitment_id))];
    const { data: commitments } = await supabase
      .from('commitments')
      .select('id, commitment_type, org_id, created_at, organizations(id, name, strategic_value)')
      .in('id', commitmentIds);

    const commitmentMap = new Map<string, typeof commitments extends (infer T)[] | null ? T : never>();
    for (const c of commitments || []) {
      commitmentMap.set(c.id, c);
    }

    // Aggregate by commitment_type
    const typeStats: Record<string, {
      completed: number;
      snoozed: number;
      cancelled: number;
      total_days_to_complete: number;
      completion_count: number;
    }> = {};

    // Aggregate by org strategic_value
    const valueStats: Record<string, {
      completed: number;
      snoozed: number;
      cancelled: number;
      total_days_to_complete: number;
      completion_count: number;
    }> = {};

    // Totals
    let totalCompleted = 0;
    let totalSnoozed = 0;
    let totalCancelled = 0;
    let totalDaysToComplete = 0;
    let totalCompletionCount = 0;

    for (const activity of activities) {
      const commitment = commitmentMap.get(activity.commitment_id);
      if (!commitment) continue;

      const cType = commitment.commitment_type || 'unknown';
      const org = commitment.organizations as unknown as { id: string; name: string; strategic_value: string } | null;
      const sValue = org?.strategic_value || 'null';

      // Initialize stats buckets
      if (!typeStats[cType]) {
        typeStats[cType] = { completed: 0, snoozed: 0, cancelled: 0, total_days_to_complete: 0, completion_count: 0 };
      }
      if (!valueStats[sValue]) {
        valueStats[sValue] = { completed: 0, snoozed: 0, cancelled: 0, total_days_to_complete: 0, completion_count: 0 };
      }

      if (activity.action === 'completed') {
        typeStats[cType].completed++;
        valueStats[sValue].completed++;
        totalCompleted++;

        // Calculate days from creation to completion
        const createdAt = new Date(commitment.created_at);
        const completedAt = new Date(activity.created_at);
        const daysToComplete = (completedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        typeStats[cType].total_days_to_complete += daysToComplete;
        typeStats[cType].completion_count++;
        valueStats[sValue].total_days_to_complete += daysToComplete;
        valueStats[sValue].completion_count++;
        totalDaysToComplete += daysToComplete;
        totalCompletionCount++;
      } else if (activity.action === 'snoozed' || activity.action === 'deferred') {
        typeStats[cType].snoozed++;
        valueStats[sValue].snoozed++;
        totalSnoozed++;
      } else if (activity.action === 'cancelled') {
        typeStats[cType].cancelled++;
        valueStats[sValue].cancelled++;
        totalCancelled++;
      }
    }

    // Format stats for the prompt
    const typeStatsText = Object.entries(typeStats)
      .map(([type, s]) => {
        const avgDays = s.completion_count > 0 ? (s.total_days_to_complete / s.completion_count).toFixed(1) : 'N/A';
        const total = s.completed + s.cancelled;
        const completionRate = total > 0 ? ((s.completed / total) * 100).toFixed(0) : 'N/A';
        const snoozeFreq = (s.completed + s.snoozed + s.cancelled) > 0
          ? ((s.snoozed / (s.completed + s.snoozed + s.cancelled)) * 100).toFixed(0)
          : 'N/A';
        return `  ${type}: completed=${s.completed}, snoozed=${s.snoozed}, cancelled=${s.cancelled}, avg_days_to_complete=${avgDays}, completion_rate=${completionRate}%, snooze_frequency=${snoozeFreq}%`;
      })
      .join('\n');

    const valueStatsText = Object.entries(valueStats)
      .map(([value, s]) => {
        const avgDays = s.completion_count > 0 ? (s.total_days_to_complete / s.completion_count).toFixed(1) : 'N/A';
        const total = s.completed + s.cancelled;
        const completionRate = total > 0 ? ((s.completed / total) * 100).toFixed(0) : 'N/A';
        const snoozeFreq = (s.completed + s.snoozed + s.cancelled) > 0
          ? ((s.snoozed / (s.completed + s.snoozed + s.cancelled)) * 100).toFixed(0)
          : 'N/A';
        return `  ${value}: completed=${s.completed}, snoozed=${s.snoozed}, cancelled=${s.cancelled}, avg_days_to_complete=${avgDays}, completion_rate=${completionRate}%, snooze_frequency=${snoozeFreq}%`;
      })
      .join('\n');

    // Find most deferred and fastest completed types
    let mostDeferredType = 'N/A';
    let maxSnoozeRate = 0;
    let fastestType = 'N/A';
    let minAvgDays = Infinity;

    for (const [type, s] of Object.entries(typeStats)) {
      const total = s.completed + s.snoozed + s.cancelled;
      const snoozeRate = total > 0 ? s.snoozed / total : 0;
      if (snoozeRate > maxSnoozeRate) {
        maxSnoozeRate = snoozeRate;
        mostDeferredType = type;
      }
      const avgDays = s.completion_count > 0 ? s.total_days_to_complete / s.completion_count : Infinity;
      if (avgDays < minAvgDays && s.completion_count > 0) {
        minAvgDays = avgDays;
        fastestType = type;
      }
    }

    const avgCompletionTime = totalCompletionCount > 0
      ? (totalDaysToComplete / totalCompletionCount).toFixed(1)
      : 'N/A';

    const snoozedItemCount = new Set(
      activities.filter((a) => a.action === 'snoozed' || a.action === 'deferred').map((a) => a.commitment_id)
    ).size;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Analyze Josh's task completion behavior from the past 90 days.

Completion data by type:
${typeStatsText || 'No data available'}

Completion data by org strategic value:
${valueStatsText || 'No data available'}

Raw activity summary:
- Total completed: ${totalCompleted}
- Total snoozed: ${totalSnoozed} times across ${snoozedItemCount} items
- Total cancelled: ${totalCancelled}
- Average completion time: ${avgCompletionTime} days
- Most deferred type: ${mostDeferredType}
- Fastest completed type: ${fastestType}

For each combination of commitment_type + org strategic_value, assign an ai_priority_modifier (-20 to +20):
- Items Josh chronically defers should get a POSITIVE modifier (push them higher so they stay visible)
- Items Josh consistently handles quickly need NO modifier (0)
- Items from strategic clients that Josh defers should get the HIGHEST positive modifier

Return JSON only (no markdown, no code blocks):
{
  "modifiers": [
    {
      "commitment_type": "...",
      "org_strategic_value": "strategic|standard|emerging|null",
      "modifier": -20 to +20,
      "reasoning": "why this modifier"
    }
  ],
  "insights": [
    "Insight string 1",
    "Insight string 2"
  ]
}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    // Parse JSON from response
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const result = JSON.parse(jsonStr);

    // Apply modifiers to matching pending/in_progress commitments
    let updatedCount = 0;
    for (const mod of result.modifiers || []) {
      // Build query for matching commitments
      let query = supabase
        .from('commitments')
        .update({ ai_priority_modifier: mod.modifier })
        .eq('commitment_type', mod.commitment_type)
        .in('status', ['pending', 'in_progress']);

      if (mod.org_strategic_value && mod.org_strategic_value !== 'null') {
        // Need to filter by org strategic_value via a subquery approach
        // Fetch matching org IDs first
        const { data: matchingOrgs } = await supabase
          .from('organizations')
          .select('id')
          .eq('strategic_value', mod.org_strategic_value);

        if (matchingOrgs && matchingOrgs.length > 0) {
          const orgIds = matchingOrgs.map((o) => o.id);
          query = query.in('org_id', orgIds);
        } else {
          // No matching orgs, skip this modifier
          continue;
        }
      } else if (mod.org_strategic_value === 'null') {
        query = query.is('org_id', null);
      }

      const { error: updateError } = await query;
      if (updateError) {
        console.error(`Error updating commitments for ${mod.commitment_type}/${mod.org_strategic_value}:`, updateError);
      } else {
        updatedCount++;
      }
    }

    // Store insights in josh_profile
    if (result.insights && result.insights.length > 0) {
      const { error: insightError } = await supabase
        .from('josh_profile')
        .upsert(
          {
            profile_type: 'priority_patterns_insights',
            profile_data: {
              insights: result.insights,
              modifiers: result.modifiers,
              analyzed_at: new Date().toISOString(),
              activity_count: activities.length,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'profile_type' }
        );

      if (insightError) {
        console.error('Error storing insights:', insightError);
      }
    }

    return NextResponse.json({
      success: true,
      modifiers: result.modifiers,
      insights: result.insights,
      commitments_updated: updatedCount,
      activities_analyzed: activities.length,
    });
  } catch (error) {
    console.error('Priority learning error:', error);
    return NextResponse.json(
      { error: 'Priority learning failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';

interface OrgHealth {
  org_id: string;
  org_name: string;
  strategic_value: 'strategic' | 'standard' | 'emerging';
  score: number;
  status: 'thriving' | 'healthy' | 'cooling' | 'at_risk';
  days_since_contact: number;
  overdue_count: number;
  completion_rate: number;
  trend: 'improving' | 'stable' | 'declining';
  alert: string | null;
  revenue_context?: {
    total_revenue: number;
    active_engagements: number;
    next_renewal: string | null;
  };
}

function scoreStatus(score: number): OrgHealth['status'] {
  if (score >= 80) return 'thriving';
  if (score >= 60) return 'healthy';
  if (score >= 40) return 'cooling';
  return 'at_risk';
}

function scoreContactRecency(days: number): number {
  if (days <= 7) return 25;
  if (days <= 14) return 20;
  if (days <= 21) return 15;
  if (days <= 30) return 10;
  return 0;
}

function scoreOverdue(count: number): number {
  if (count === 0) return 25;
  if (count === 1) return 20;
  if (count === 2) return 15;
  return 5;
}

function scoreFrequency(avgDays: number | null): number {
  if (avgDays === null) return 5;
  if (avgDays <= 10) return 25;   // weekly-ish
  if (avgDays <= 18) return 20;   // biweekly-ish
  if (avgDays <= 35) return 15;   // monthly-ish
  return 5;
}

function buildAlert(daysSinceContact: number, overdueCount: number): string | null {
  const parts: string[] = [];
  if (daysSinceContact > 14) {
    parts.push(`No contact in ${daysSinceContact} days`);
  }
  if (overdueCount > 0) {
    parts.push(`${overdueCount} commitment${overdueCount > 1 ? 's' : ''} overdue`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch all active organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name, strategic_value')
      .eq('status', 'active');

    if (orgsError) {
      return NextResponse.json({ error: orgsError.message }, { status: 500 });
    }

    if (!orgs || orgs.length === 0) {
      return NextResponse.json([]);
    }

    const orgIds = orgs.map((o) => o.id);
    const now = new Date();

    // Fetch all transcripts for active orgs (last 90 days for trend calculation)
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [transcriptsRes, commitmentsRes, engagementsRes] = await Promise.all([
      supabase
        .from('transcripts')
        .select('org_id, transcript_date')
        .in('org_id', orgIds)
        .gte('transcript_date', ninetyDaysAgo.toISOString().split('T')[0])
        .order('transcript_date', { ascending: false }),
      supabase
        .from('commitments')
        .select('org_id, status, due_date')
        .in('org_id', orgIds),
      supabase
        .from('engagements')
        .select('org_id, value_amount, status, end_date')
        .in('org_id', orgIds),
    ]);

    const transcripts = transcriptsRes.data || [];
    const commitments = commitmentsRes.data || [];

    // Aggregate engagement revenue by org
    const engagementsByOrg = new Map<string, { total: number; active: number; nextRenewal: string | null }>();
    for (const e of engagementsRes.data || []) {
      if (!e.org_id) continue;
      if (!engagementsByOrg.has(e.org_id)) engagementsByOrg.set(e.org_id, { total: 0, active: 0, nextRenewal: null });
      const entry = engagementsByOrg.get(e.org_id)!;
      entry.total += Number(e.value_amount) || 0;
      if (e.status === 'active' || e.status === 'pending') {
        entry.active += 1;
        if (e.end_date) {
          if (!entry.nextRenewal || e.end_date < entry.nextRenewal) entry.nextRenewal = e.end_date;
        }
      }
    }

    // Group by org
    const transcriptsByOrg = new Map<string, { transcript_date: string }[]>();
    for (const t of transcripts) {
      if (!t.org_id) continue;
      if (!transcriptsByOrg.has(t.org_id)) transcriptsByOrg.set(t.org_id, []);
      transcriptsByOrg.get(t.org_id)!.push(t);
    }

    const commitmentsByOrg = new Map<string, { status: string; due_date: string | null }[]>();
    for (const c of commitments) {
      if (!c.org_id) continue;
      if (!commitmentsByOrg.has(c.org_id)) commitmentsByOrg.set(c.org_id, []);
      commitmentsByOrg.get(c.org_id)!.push(c);
    }

    const results: OrgHealth[] = orgs.map((org) => {
      const orgTranscripts = transcriptsByOrg.get(org.id) || [];
      const orgCommitments = commitmentsByOrg.get(org.id) || [];

      // Days since last contact
      let daysSinceContact: number;
      if (orgTranscripts.length > 0) {
        const lastDate = new Date(orgTranscripts[0].transcript_date);
        daysSinceContact = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      } else {
        daysSinceContact = 999;
      }

      // Commitment stats
      const total = orgCommitments.length;
      const completed = orgCommitments.filter((c) => c.status === 'completed').length;
      const overdue = orgCommitments.filter(
        (c) =>
          c.due_date &&
          new Date(c.due_date) < now &&
          !['completed', 'cancelled'].includes(c.status)
      ).length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 100;
      const followThroughScore = total > 0 ? Math.round((completed / total) * 25) : 25;

      // Session frequency (avg days between sessions)
      let avgDaysBetween: number | null = null;
      if (orgTranscripts.length >= 2) {
        const dates = orgTranscripts.map((t) => new Date(t.transcript_date).getTime());
        let totalGap = 0;
        for (let i = 0; i < dates.length - 1; i++) {
          totalGap += dates[i] - dates[i + 1];
        }
        avgDaysBetween = Math.round(totalGap / (dates.length - 1) / (1000 * 60 * 60 * 24));
      }

      // Calculate score
      const score = Math.min(100, Math.max(0,
        scoreContactRecency(daysSinceContact) +
        followThroughScore +
        scoreOverdue(overdue) +
        scoreFrequency(avgDaysBetween)
      ));

      // Trend: compare last 30 days vs prior 30 days
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sixtyDaysAgo = new Date(now);
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const recentSessions = orgTranscripts.filter(
        (t) => new Date(t.transcript_date) >= thirtyDaysAgo
      ).length;
      const priorSessions = orgTranscripts.filter(
        (t) => new Date(t.transcript_date) >= sixtyDaysAgo && new Date(t.transcript_date) < thirtyDaysAgo
      ).length;

      let trend: OrgHealth['trend'] = 'stable';
      if (recentSessions > priorSessions) trend = 'improving';
      else if (recentSessions < priorSessions) trend = 'declining';

      const engData = engagementsByOrg.get(org.id);

      return {
        org_id: org.id,
        org_name: org.name,
        strategic_value: (org as Record<string, unknown>).strategic_value as OrgHealth['strategic_value'] || 'standard',
        score,
        status: scoreStatus(score),
        days_since_contact: daysSinceContact === 999 ? -1 : daysSinceContact,
        overdue_count: overdue,
        completion_rate: completionRate,
        trend,
        alert: buildAlert(daysSinceContact === 999 ? 999 : daysSinceContact, overdue),
        revenue_context: engData ? {
          total_revenue: Math.round(engData.total),
          active_engagements: engData.active,
          next_renewal: engData.nextRenewal,
        } : undefined,
      };
    });

    // Sort by score ascending (worst first)
    results.sort((a, b) => a.score - b.score);

    return NextResponse.json(results);
  } catch (err) {
    console.error('Relationship health error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orgId = body.org_id as string | undefined;

    const supabase = createServerClient();

    // If org_id provided, get single org health + AI recommendations
    if (!orgId) {
      return NextResponse.json(
        { error: 'org_id is required for detailed health report' },
        { status: 400 }
      );
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [transcriptsRes, commitmentsRes] = await Promise.all([
      supabase
        .from('transcripts')
        .select('org_id, transcript_date, summary')
        .eq('org_id', orgId)
        .gte('transcript_date', ninetyDaysAgo.toISOString().split('T')[0])
        .order('transcript_date', { ascending: false }),
      supabase
        .from('commitments')
        .select('org_id, status, due_date, title, owner')
        .eq('org_id', orgId),
    ]);

    const orgTranscripts = transcriptsRes.data || [];
    const orgCommitments = commitmentsRes.data || [];

    // Calculate same scores as GET
    let daysSinceContact: number;
    if (orgTranscripts.length > 0) {
      const lastDate = new Date(orgTranscripts[0].transcript_date);
      daysSinceContact = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    } else {
      daysSinceContact = 999;
    }

    const total = orgCommitments.length;
    const completed = orgCommitments.filter((c) => c.status === 'completed').length;
    const overdue = orgCommitments.filter(
      (c) =>
        c.due_date &&
        new Date(c.due_date) < now &&
        !['completed', 'cancelled'].includes(c.status)
    );
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 100;
    const followThroughScore = total > 0 ? Math.round((completed / total) * 25) : 25;

    let avgDaysBetween: number | null = null;
    if (orgTranscripts.length >= 2) {
      const dates = orgTranscripts.map((t) => new Date(t.transcript_date).getTime());
      let totalGap = 0;
      for (let i = 0; i < dates.length - 1; i++) {
        totalGap += dates[i] - dates[i + 1];
      }
      avgDaysBetween = Math.round(totalGap / (dates.length - 1) / (1000 * 60 * 60 * 24));
    }

    const score = Math.min(100, Math.max(0,
      scoreContactRecency(daysSinceContact) +
      followThroughScore +
      scoreOverdue(overdue.length) +
      scoreFrequency(avgDaysBetween)
    ));

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const recentSessions = orgTranscripts.filter(
      (t) => new Date(t.transcript_date) >= thirtyDaysAgo
    ).length;
    const priorSessions = orgTranscripts.filter(
      (t) => new Date(t.transcript_date) >= sixtyDaysAgo && new Date(t.transcript_date) < thirtyDaysAgo
    ).length;

    let trend: OrgHealth['trend'] = 'stable';
    if (recentSessions > priorSessions) trend = 'improving';
    else if (recentSessions < priorSessions) trend = 'declining';

    const healthData: OrgHealth = {
      org_id: org.id,
      org_name: org.name,
      strategic_value: org.strategic_value || 'standard',
      score,
      status: scoreStatus(score),
      days_since_contact: daysSinceContact === 999 ? -1 : daysSinceContact,
      overdue_count: overdue.length,
      completion_rate: completionRate,
      trend,
      alert: buildAlert(daysSinceContact === 999 ? 999 : daysSinceContact, overdue.length),
    };

    // Generate AI recommendations
    const overdueList = overdue
      .map((c) => `- ${c.title} (due ${c.due_date}, owner: ${c.owner})`)
      .join('\n') || 'None';

    const recentSummaries = orgTranscripts
      .slice(0, 3)
      .map((t) => `- ${t.transcript_date}: ${t.summary || 'No summary'}`)
      .join('\n') || 'No recent sessions';

    const prompt = `You are a coaching practice advisor. Analyze this client relationship health data and provide 3-5 specific, actionable recommendations.

Client: ${org.name}
Industry: ${org.industry || 'Not specified'}
Health Score: ${score}/100 (${healthData.status})
Days since last contact: ${daysSinceContact === 999 ? 'No sessions recorded' : daysSinceContact}
Commitment completion rate: ${completionRate}%
Overdue commitments:
${overdueList}

Session frequency: ${avgDaysBetween ? `every ~${avgDaysBetween} days` : 'Insufficient data'}
Trend: ${trend}

Recent session summaries:
${recentSummaries}

Provide recommendations as a JSON array of objects with "recommendation" (string) and "priority" ("high" | "medium" | "low") fields. Focus on relationship re-engagement, commitment follow-through, and session cadence. Be specific to this client's situation.`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    let recommendations: { recommendation: string; priority: string }[] = [];

    if (textContent && textContent.type === 'text') {
      try {
        // Extract JSON from the response
        const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          recommendations = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // If JSON parsing fails, return the raw text
        recommendations = [{ recommendation: textContent.text, priority: 'medium' }];
      }
    }

    return NextResponse.json({
      health: healthData,
      recommendations,
    });
  } catch (error) {
    console.error('Relationship health detail error:', error);
    return NextResponse.json(
      { error: 'Failed to generate relationship health report' },
      { status: 500 }
    );
  }
}

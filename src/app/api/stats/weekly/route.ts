import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();
    const weeks = 4;
    const weekData: Array<{
      label: string;
      created: number;
      completed: number;
    }> = [];

    for (let w = weeks - 1; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (w + 1) * 7);
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - w * 7);

      const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      const { count: created } = await supabase
        .from('commitments')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekStart.toISOString())
        .lt('created_at', weekEnd.toISOString());

      const { count: completed } = await supabase
        .from('commitments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('completed_at', weekStart.toISOString())
        .lt('completed_at', weekEnd.toISOString());

      weekData.push({ label, created: created || 0, completed: completed || 0 });
    }

    // Completion rate trend (per week)
    const completionRates = weekData.map((w) =>
      w.created > 0 ? Math.round((w.completed / w.created) * 100) : 0
    );

    // Client engagement this week
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - 7);

    const { data: recentTranscripts } = await supabase
      .from('transcripts')
      .select('org_id, organizations(name)')
      .gte('transcript_date', thisWeekStart.toISOString())
      .not('org_id', 'is', null);

    const { data: recentCommitments } = await supabase
      .from('commitments')
      .select('org_id, organizations(name)')
      .gte('created_at', thisWeekStart.toISOString())
      .not('org_id', 'is', null);

    // Count touches per client
    const clientTouches: Record<string, { name: string; count: number }> = {};
    for (const t of recentTranscripts || []) {
      if (!t.org_id) continue;
      const name = (t.organizations as unknown as { name: string } | null)?.name || 'Unknown';
      if (!clientTouches[t.org_id]) clientTouches[t.org_id] = { name, count: 0 };
      clientTouches[t.org_id].count += 2; // sessions count double
    }
    for (const c of recentCommitments || []) {
      if (!c.org_id) continue;
      const name = (c.organizations as unknown as { name: string } | null)?.name || 'Unknown';
      if (!clientTouches[c.org_id]) clientTouches[c.org_id] = { name, count: 0 };
      clientTouches[c.org_id].count += 1;
    }

    const clientEngagement = Object.values(clientTouches)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Commitment type breakdown (this week)
    const { data: thisWeekCommitments } = await supabase
      .from('commitments')
      .select('commitment_type')
      .gte('created_at', thisWeekStart.toISOString());

    const typeBreakdown: Record<string, number> = {};
    for (const c of thisWeekCommitments || []) {
      typeBreakdown[c.commitment_type] = (typeBreakdown[c.commitment_type] || 0) + 1;
    }

    return NextResponse.json({
      weeklyBars: weekData,
      completionRates,
      clientEngagement,
      typeBreakdown,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to compute weekly stats' }, { status: 500 });
  }
}

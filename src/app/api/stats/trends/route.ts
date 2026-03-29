import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();
    const days = 7;

    // Get all commitments for trend calculation
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);

    const { data: commitments } = await supabase
      .from('commitments')
      .select('status, due_date, owner, created_at, completed_at, updated_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    const { data: allOpen } = await supabase
      .from('commitments')
      .select('status, due_date, owner')
      .in('status', ['pending', 'in_progress', 'snoozed', 'waiting']);

    // Calculate daily snapshots (approximate from current state + activity)
    const overdueTrend: number[] = [];
    const dueTodayTrend: number[] = [];
    const completedTrend: number[] = [];
    const waitingTrend: number[] = [];

    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      date.setHours(23, 59, 59, 999);
      const dateStr = date.toISOString().split('T')[0];

      // Count overdue as of that date
      const overdue = (allOpen || []).filter(
        (c) => c.due_date && c.due_date.split('T')[0] < dateStr && c.status !== 'waiting'
      ).length;

      // Due on that date
      const dueOnDay = (allOpen || []).filter(
        (c) => c.due_date && c.due_date.split('T')[0] === dateStr
      ).length;

      // Completed on that date
      const completedOnDay = (commitments || []).filter(
        (c) => c.completed_at && c.completed_at.split('T')[0] === dateStr
      ).length;

      // Waiting
      const waiting = (allOpen || []).filter((c) => c.status === 'waiting').length;

      overdueTrend.push(overdue);
      dueTodayTrend.push(dueOnDay);
      completedTrend.push(completedOnDay);
      waitingTrend.push(waiting);
    }

    return NextResponse.json({
      overdue: overdueTrend,
      dueToday: dueTodayTrend,
      completed: completedTrend,
      waiting: waitingTrend,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to compute trends' }, { status: 500 });
  }
}

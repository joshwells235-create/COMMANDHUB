import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();

    // Time boundaries
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch life logs this week
    const { data: weekLogs } = await supabase
      .from('life_logs')
      .select('*')
      .gte('logged_at', weekStart.toISOString())
      .order('logged_at', { ascending: false });

    // Fetch life logs this month (for monthly goals)
    const { data: monthLogs } = await supabase
      .from('life_logs')
      .select('id, log_type, tags, logged_at')
      .gte('logged_at', monthStart.toISOString());

    // Fetch personal goals
    const { data: goalsProfile } = await supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'personal_goals')
      .single();

    // Fetch personal commitments (open)
    const { data: personalCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, status')
      .eq('category', 'personal')
      .in('status', ['pending', 'in_progress'])
      .order('due_date', { ascending: true })
      .limit(10);

    // Compute goal progress
    const goals = (goalsProfile?.profile_data as { goals?: Array<Record<string, unknown>> })?.goals || [];
    const goalProgress = goals.filter((g) => g.active).map((goal) => {
      const tag = goal.tracking_tag as string;
      const frequency = goal.frequency as string;
      const target = goal.target as number;

      let logs;
      if (frequency === 'weekly') {
        logs = (weekLogs || []).filter((l) => l.tags?.includes(tag));
      } else if (frequency === 'monthly') {
        logs = (monthLogs || []).filter((l) => l.tags?.includes(tag));
      } else {
        logs = [];
      }

      return {
        id: goal.id,
        title: goal.title,
        type: goal.type,
        frequency,
        target: target || 0,
        current: logs.length,
        onTrack: target ? logs.length >= Math.floor(target * (frequency === 'weekly' ? now.getDay() / 7 : now.getDate() / 30)) : false,
        milestones: goal.milestones || null,
        currentMilestone: goal.current_milestone ?? null,
      };
    });

    // Group week logs by tag
    const weekByTag: Record<string, number> = {};
    for (const log of weekLogs || []) {
      for (const tag of log.tags || []) {
        weekByTag[tag] = (weekByTag[tag] || 0) + 1;
      }
    }

    return NextResponse.json({
      weekLogs: weekLogs || [],
      weekByTag,
      monthLogCount: monthLogs?.length || 0,
      goalProgress,
      personalCommitments: personalCommitments || [],
    });
  } catch (error) {
    console.error('Life summary error:', error);
    return NextResponse.json({ error: 'Failed to fetch life summary' }, { status: 500 });
  }
}

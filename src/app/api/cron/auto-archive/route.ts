import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const now = new Date();
    const nowIso = now.toISOString();

    const results = {
      overdue_stale: 0,
      no_due_date_stale: 0,
      stale_waiting: 0,
    };

    // --- 1. Overdue 45+ days with no activity in 14+ days ---
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

    const { data: overdueStale } = await supabase
      .from('commitments')
      .select('id, title')
      .in('status', ['pending', 'in_progress'])
      .not('due_date', 'is', null)
      .lt('due_date', fortyFiveDaysAgo)
      .lt('last_touched_at', fourteenDaysAgo);

    for (const c of overdueStale || []) {
      const { error } = await supabase
        .from('commitments')
        .update({ status: 'cancelled', completed_at: nowIso })
        .eq('id', c.id);

      if (!error) {
        await supabase.from('commitment_activity').insert({
          commitment_id: c.id,
          action: 'cancelled',
          details: { reason: 'Auto-archived: overdue 45+ days with no activity in 14+ days' },
        });
        results.overdue_stale++;
      }
    }

    // --- 2. No due date + created 60+ days ago with no activity in 30+ days ---
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    const { data: noDueDateStale } = await supabase
      .from('commitments')
      .select('id, title')
      .in('status', ['pending', 'in_progress'])
      .is('due_date', null)
      .lt('created_at', sixtyDaysAgo)
      .lt('last_touched_at', thirtyDaysAgo);

    for (const c of noDueDateStale || []) {
      const { error } = await supabase
        .from('commitments')
        .update({ status: 'cancelled', completed_at: nowIso })
        .eq('id', c.id);

      if (!error) {
        await supabase.from('commitment_activity').insert({
          commitment_id: c.id,
          action: 'cancelled',
          details: { reason: 'Auto-archived: no due date, created 60+ days ago, inactive 30+ days' },
        });
        results.no_due_date_stale++;
      }
    }

    // --- 3. Waiting status 30+ days with no activity ---
    const { data: staleWaiting } = await supabase
      .from('commitments')
      .select('id, title')
      .eq('status', 'waiting')
      .lt('last_touched_at', thirtyDaysAgo);

    for (const c of staleWaiting || []) {
      const { error } = await supabase
        .from('commitments')
        .update({ status: 'cancelled', completed_at: nowIso })
        .eq('id', c.id);

      if (!error) {
        await supabase.from('commitment_activity').insert({
          commitment_id: c.id,
          action: 'cancelled',
          details: { reason: 'Auto-archived: waiting 30+ days with no activity' },
        });
        results.stale_waiting++;
      }
    }

    const totalArchived = results.overdue_stale + results.no_due_date_stale + results.stale_waiting;

    return NextResponse.json({
      success: true,
      archived: results,
      total_archived: totalArchived,
      ran_at: nowIso,
    });
  } catch (error) {
    console.error('Auto-archive error:', error);
    return NextResponse.json(
      { error: 'Auto-archive failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

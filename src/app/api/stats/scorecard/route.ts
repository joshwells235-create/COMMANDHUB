import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();

    // Time boundaries
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const prevThirtyStart = new Date(thirtyDaysAgo);
    prevThirtyStart.setDate(prevThirtyStart.getDate() - 30);

    // --- Practice Health ---
    const { data: activeOrgs } = await supabase
      .from('organizations')
      .select('id, name, status, strategic_value, is_own_business')
      .eq('status', 'active')
      .eq('is_own_business', false);

    const totalClients = activeOrgs?.length || 0;

    // Sessions this month vs last month
    const { count: sessionsThisMonth } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true })
      .eq('is_processed', true)
      .gte('transcript_date', thirtyDaysAgo.toISOString());

    const { count: sessionsLastMonth } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true })
      .eq('is_processed', true)
      .gte('transcript_date', prevThirtyStart.toISOString())
      .lt('transcript_date', thirtyDaysAgo.toISOString());

    // --- Commitment Velocity ---
    const { data: recentCommitments } = await supabase
      .from('commitments')
      .select('id, status, created_at, completed_at, due_date, commitment_type, owner, org_id')
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { data: prevCommitments } = await supabase
      .from('commitments')
      .select('id, status, created_at, completed_at')
      .gte('created_at', prevThirtyStart.toISOString())
      .lt('created_at', thirtyDaysAgo.toISOString());

    const created30d = recentCommitments?.length || 0;
    const completed30d = recentCommitments?.filter(c => c.status === 'completed').length || 0;
    const completionRate = created30d > 0 ? Math.round((completed30d / created30d) * 100) : 0;

    const prevCreated = prevCommitments?.length || 0;
    const prevCompleted = prevCommitments?.filter(c => c.status === 'completed').length || 0;
    const prevCompletionRate = prevCreated > 0 ? Math.round((prevCompleted / prevCreated) * 100) : 0;

    // Average time to complete (in days)
    const completedWithTime = (recentCommitments || []).filter(
      c => c.status === 'completed' && c.completed_at && c.created_at
    );
    const avgCompletionDays = completedWithTime.length > 0
      ? Math.round(
          completedWithTime.reduce((sum, c) => {
            const created = new Date(c.created_at).getTime();
            const completed = new Date(c.completed_at!).getTime();
            return sum + (completed - created) / (1000 * 60 * 60 * 24);
          }, 0) / completedWithTime.length * 10
        ) / 10
      : null;

    // --- Currently overdue ---
    const { data: overdueCommitments } = await supabase
      .from('commitments')
      .select('id, due_date, org_id, title')
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', now.toISOString())
      .not('due_date', 'is', null);

    const overdueCount = overdueCommitments?.length || 0;

    // --- Promises kept rate (josh's promises specifically) ---
    const joshPromises = (recentCommitments || []).filter(
      c => c.owner === 'josh' && c.commitment_type === 'promise_made'
    );
    const joshPromisesKept = joshPromises.filter(c => c.status === 'completed').length;
    const promiseKeptRate = joshPromises.length > 0
      ? Math.round((joshPromisesKept / joshPromises.length) * 100)
      : null;

    // --- Client coverage (clients touched in last 7 days) ---
    const { data: recentTranscripts } = await supabase
      .from('transcripts')
      .select('org_id')
      .gte('transcript_date', sevenDaysAgo.toISOString())
      .not('org_id', 'is', null);

    const { data: recentEmails } = await supabase
      .from('emails')
      .select('org_id')
      .gte('received_at', sevenDaysAgo.toISOString())
      .not('org_id', 'is', null);

    const touchedClients = new Set<string>();
    (recentTranscripts || []).forEach(t => { if (t.org_id) touchedClients.add(t.org_id); });
    (recentEmails || []).forEach(e => { if (e.org_id) touchedClients.add(e.org_id); });
    const clientsTouched7d = touchedClients.size;

    // --- Email processing status ---
    const { count: totalEmails } = await supabase
      .from('emails')
      .select('*', { count: 'exact', head: true });
    const { count: processedEmails } = await supabase
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('is_processed', true);
    const { count: unprocessedEmails } = await supabase
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('is_processed', false);

    // --- Needs reply count ---
    const { count: needsReplyCount } = await supabase
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('is_processed', true)
      .not('ai_extraction->needs_reply', 'eq', 'false')
      .not('ai_extraction', 'is', null);

    // --- Waiting on others ---
    const { count: waitingCount } = await supabase
      .from('commitments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'waiting');

    // --- Session frequency per client (30 days) ---
    const { data: monthTranscripts } = await supabase
      .from('transcripts')
      .select('org_id')
      .gte('transcript_date', thirtyDaysAgo.toISOString())
      .eq('is_processed', true)
      .not('org_id', 'is', null);

    const sessionsByClient: Record<string, number> = {};
    (monthTranscripts || []).forEach(t => {
      if (t.org_id) sessionsByClient[t.org_id] = (sessionsByClient[t.org_id] || 0) + 1;
    });
    const clientsWithSessions = Object.keys(sessionsByClient).length;
    const avgSessionsPerClient = clientsWithSessions > 0
      ? Math.round((Object.values(sessionsByClient).reduce((a, b) => a + b, 0) / clientsWithSessions) * 10) / 10
      : 0;

    return NextResponse.json({
      practice: {
        totalClients,
        clientsTouched7d,
        coverageRate: totalClients > 0 ? Math.round((clientsTouched7d / totalClients) * 100) : 0,
        sessionsThisMonth: sessionsThisMonth || 0,
        sessionsLastMonth: sessionsLastMonth || 0,
        sessionsTrend: (sessionsThisMonth || 0) - (sessionsLastMonth || 0),
        avgSessionsPerClient,
      },
      velocity: {
        created30d,
        completed30d,
        completionRate,
        prevCompletionRate,
        completionTrend: completionRate - prevCompletionRate,
        avgCompletionDays,
        overdueCount,
        promiseKeptRate,
        waitingCount: waitingCount || 0,
      },
      email: {
        total: totalEmails || 0,
        processed: processedEmails || 0,
        unprocessed: unprocessedEmails || 0,
        processingRate: (totalEmails || 0) > 0
          ? Math.round(((processedEmails || 0) / (totalEmails || 0)) * 100)
          : 0,
        needsReply: needsReplyCount || 0,
      },
    });
  } catch (error) {
    console.error('Scorecard error:', error);
    return NextResponse.json({ error: 'Failed to compute scorecard' }, { status: 500 });
  }
}

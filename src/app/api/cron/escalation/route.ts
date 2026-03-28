import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';

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
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
    const todayStr = now.toISOString().split('T')[0];

    // 1. Recalculate priority scores
    const { error: priorityError } = await supabase.rpc('calculate_priority_scores');
    if (priorityError) {
      console.error('Error recalculating priority scores:', priorityError);
    }

    // 2. Wake snoozed commitments
    const { error: snoozeError } = await supabase.rpc('wake_snoozed_commitments');
    if (snoozeError) {
      console.error('Error waking snoozed commitments:', snoozeError);
    }

    // 3. Fetch commitments needing escalation
    // escalation_level >= 3 AND (last_escalated_at is NULL OR last_escalated_at < 24 hours ago)
    const { data: escalationCandidates } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, other_party, escalation_level, last_escalated_at, created_at, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .gte('escalation_level', 3);

    // Filter by last_escalated_at
    const needsEscalation = (escalationCandidates || []).filter((c) => {
      if (!c.last_escalated_at) return true;
      return new Date(c.last_escalated_at) < new Date(twentyFourHoursAgo);
    });

    // 4. Send escalation emails
    const recipient = process.env.JOSH_EMAIL || 'josh@example.com';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://commandhub.vercel.app';
    let escalationsSent = 0;

    for (const commitment of needsEscalation) {
      const org = commitment.organizations as unknown as { id: string; name: string } | null;
      const promisedTo = commitment.other_party || org?.name || 'Unknown';
      const daysOverdue = commitment.due_date
        ? Math.floor((now.getTime() - new Date(commitment.due_date).getTime()) / 86400000)
        : Math.floor((now.getTime() - new Date(commitment.created_at).getTime()) / 86400000);

      const html = `
<div style="background-color: #0f172a; color: #e2e8f0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background-color: #991b1b; color: #fecaca; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px;">
      <strong style="font-size: 14px;">ESCALATION LEVEL ${commitment.escalation_level}</strong>
    </div>
    <h2 style="color: #f87171; margin: 0 0 16px 0; font-size: 20px;">${commitment.title}</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      <tr>
        <td style="padding: 8px 0; color: #94a3b8; width: 140px;">Type</td>
        <td style="padding: 8px 0; color: #e2e8f0;">${commitment.commitment_type}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #94a3b8;">Promised to</td>
        <td style="padding: 8px 0; color: #e2e8f0;">${promisedTo}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #94a3b8;">Days overdue</td>
        <td style="padding: 8px 0; color: #f87171; font-weight: bold;">${daysOverdue} days</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #94a3b8;">Due date</td>
        <td style="padding: 8px 0; color: #e2e8f0;">${commitment.due_date || 'No due date'}</td>
      </tr>
    </table>
    <a href="${appUrl}/commitments/${commitment.id}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500;">View in Command Hub</a>
  </div>
</div>`;

      await sendEmail(
        recipient,
        `COMMAND HUB ALERT: ${commitment.title}`,
        html
      );

      // 5. Update last_escalated_at
      await supabase
        .from('commitments')
        .update({ last_escalated_at: now.toISOString() })
        .eq('id', commitment.id);

      escalationsSent++;
    }

    // 6. Detect dark clients (for reference / logging)
    const { data: activeOrgs } = await supabase
      .from('organizations')
      .select('id, name, strategic_value')
      .in('status', ['active', 'prospect']);

    const darkClients: Array<{ org_id: string; name: string; strategic_value: string; days_since_contact: number }> = [];

    for (const org of activeOrgs || []) {
      const { data: recentEvents } = await supabase
        .from('calendar_events')
        .select('id')
        .eq('org_id', org.id)
        .gte('start_time', fourteenDaysAgo)
        .limit(1);

      if (recentEvents && recentEvents.length > 0) continue;

      const { data: recentCommitments } = await supabase
        .from('commitments')
        .select('id')
        .eq('org_id', org.id)
        .or(`created_at.gte.${fourteenDaysAgo},completed_at.gte.${fourteenDaysAgo}`)
        .limit(1);

      if (recentCommitments && recentCommitments.length > 0) continue;

      const { data: recentTranscripts } = await supabase
        .from('transcripts')
        .select('id')
        .eq('org_id', org.id)
        .gte('created_at', fourteenDaysAgo)
        .limit(1);

      if (recentTranscripts && recentTranscripts.length > 0) continue;

      // Calculate days since last contact
      const { data: lastEvent } = await supabase
        .from('calendar_events')
        .select('start_time')
        .eq('org_id', org.id)
        .order('start_time', { ascending: false })
        .limit(1);

      const { data: lastCommitment } = await supabase
        .from('commitments')
        .select('updated_at')
        .eq('org_id', org.id)
        .order('updated_at', { ascending: false })
        .limit(1);

      const dates: Date[] = [];
      if (lastEvent?.[0]) dates.push(new Date(lastEvent[0].start_time));
      if (lastCommitment?.[0]) dates.push(new Date(lastCommitment[0].updated_at));

      const lastContactDate = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
      const daysSinceContact = lastContactDate
        ? Math.floor((now.getTime() - lastContactDate.getTime()) / 86400000)
        : 999;

      darkClients.push({
        org_id: org.id,
        name: org.name,
        strategic_value: org.strategic_value,
        days_since_contact: daysSinceContact,
      });
    }

    return NextResponse.json({
      success: true,
      escalations_sent: escalationsSent,
      dark_clients: darkClients,
      priority_recalculated: !priorityError,
      snoozed_woken: !snoozeError,
    });
  } catch (error) {
    console.error('Escalation check error:', error);
    return NextResponse.json(
      { error: 'Escalation check failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';
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
    const now = new Date();

    // Calculate Monday of the upcoming week
    const dayOfWeek = now.getDay(); // 0=Sunday
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(monday.getDate() + daysUntilMonday);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split('T')[0];

    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 5);
    const fridayStr = friday.toISOString().split('T')[0];

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
    const todayStr = now.toISOString().split('T')[0];

    // 1. Fetch events for the upcoming week
    const { data: weekEvents } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, end_time, location, org_id, organizations(id, name)')
      .gte('start_time', `${mondayStr}T00:00:00`)
      .lt('start_time', `${fridayStr}T00:00:00`)
      .order('start_time', { ascending: true });

    // 2. Count commitments by status
    const { data: allCommitments } = await supabase
      .from('commitments')
      .select('id, status');

    const statusCounts: Record<string, number> = {};
    for (const c of allCommitments || []) {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    }

    // 3. Commitments completed in the last 7 days
    const { data: completedItems } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, completed_at, organizations(id, name)')
      .eq('status', 'completed')
      .gte('completed_at', sevenDaysAgo)
      .order('completed_at', { ascending: false });

    // 4. Overdue commitments
    const { data: overdueItems } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, created_at, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', todayStr)
      .order('due_date', { ascending: true });

    // 5. Dark clients detection
    const { data: activeOrgs } = await supabase
      .from('organizations')
      .select('id, name, strategic_value')
      .in('status', ['active', 'prospect']);

    const darkClients: Array<{ name: string; strategic_value: string; days_since_contact: number }> = [];

    for (const org of activeOrgs || []) {
      // Check for recent calendar events
      const { data: recentEvents } = await supabase
        .from('calendar_events')
        .select('id')
        .eq('org_id', org.id)
        .gte('start_time', fourteenDaysAgo)
        .limit(1);

      if (recentEvents && recentEvents.length > 0) continue;

      // Check for recent commitments created or completed
      const { data: recentCommitments } = await supabase
        .from('commitments')
        .select('id')
        .eq('org_id', org.id)
        .or(`created_at.gte.${fourteenDaysAgo},completed_at.gte.${fourteenDaysAgo}`)
        .limit(1);

      if (recentCommitments && recentCommitments.length > 0) continue;

      // Check for recent transcripts
      const { data: recentTranscripts } = await supabase
        .from('transcripts')
        .select('id')
        .eq('org_id', org.id)
        .gte('created_at', fourteenDaysAgo)
        .limit(1);

      if (recentTranscripts && recentTranscripts.length > 0) continue;

      // Find last contact date across all sources
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
        name: org.name,
        strategic_value: org.strategic_value,
        days_since_contact: daysSinceContact,
      });
    }

    // 6. Pipeline info
    const { data: pipelineEngagements } = await supabase
      .from('engagements')
      .select('id, name, status, value_amount, organizations(id, name)')
      .eq('status', 'active')
      .not('value_amount', 'is', null);

    // Build text for Claude
    const uniqueOrgIds = new Set((weekEvents || []).map((e) => e.org_id).filter(Boolean));

    const eventsText = (weekEvents || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      const start = new Date(e.start_time);
      const dayName = start.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
      const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `- ${dayName} ${time}: ${e.subject || 'No subject'}${org ? ` (${org.name})` : ''}`;
    }).join('\n') || 'No events scheduled.';

    const completedText = (completedItems || []).map((c) => {
      const org = c.organizations as unknown as { id: string; name: string } | null;
      return `- [${c.commitment_type}] ${c.title}${org ? ` (${org.name})` : ''}`;
    }).join('\n') || 'Nothing completed.';

    const overdueText = (overdueItems || []).map((c) => {
      const org = c.organizations as unknown as { id: string; name: string } | null;
      const daysOverdue = Math.floor((now.getTime() - new Date(c.due_date!).getTime()) / 86400000);
      return `- [${c.commitment_type}] ${c.title}${org ? ` (${org.name})` : ''} | ${daysOverdue} days overdue`;
    }).join('\n') || 'Nothing overdue.';

    const oldestOverdue = overdueItems && overdueItems.length > 0
      ? Math.floor((now.getTime() - new Date(overdueItems[0].due_date!).getTime()) / 86400000)
      : 0;

    // Client health: for each active org, summarize
    const clientHealthText = (activeOrgs || []).map((org) => {
      const orgEvents = (weekEvents || []).filter((e) => e.org_id === org.id);
      const orgOverdue = (overdueItems || []).filter((c) => {
        const cOrg = c.organizations as unknown as { id: string; name: string } | null;
        return cOrg?.id === org.id;
      });
      const nextEvent = orgEvents[0];
      const nextEventStr = nextEvent
        ? new Date(nextEvent.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
        : 'None this week';
      return `- ${org.name} (${org.strategic_value}): Next event: ${nextEventStr}, ${orgOverdue.length} overdue items`;
    }).join('\n') || 'No active organizations.';

    const darkClientsText = darkClients.length > 0
      ? darkClients.map((d) => `- ${d.name} (${d.strategic_value}): ${d.days_since_contact} days since last contact`).join('\n')
      : 'All clients have recent touchpoints.';

    const pipelineText = (pipelineEngagements || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      return `- ${e.name}${org ? ` (${org.name})` : ''}: $${(e.value_amount || 0).toLocaleString()}`;
    }).join('\n') || 'No active pipeline items.';

    const statusCountsText = Object.entries(statusCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Generate a weekly briefing email for Josh Wells. Week of ${mondayStr}.

WEEK AHEAD: ${(weekEvents || []).length} events across ${uniqueOrgIds.size} clients
${eventsText}

COMMITMENT STATUS: ${statusCountsText}

COMPLETED LAST WEEK: ${(completedItems || []).length} items
${completedText}

OVERDUE: ${(overdueItems || []).length} items (oldest: ${oldestOverdue} days)
${overdueText}

CLIENT HEALTH:
${clientHealthText}

DARK CLIENTS: ${darkClients.length} orgs with no touchpoint in 14+ days
${darkClientsText}

PIPELINE:
${pipelineText}

Format as clean HTML email with dark theme (#0f172a bg, #e2e8f0 text, #3b82f6 accents). Inline CSS only. Scannable sections.`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    const htmlContent = textContent.text;

    // 8. Send via Resend
    const recipient = process.env.JOSH_EMAIL || 'josh@example.com';
    await sendEmail(recipient, `Weekly Briefing - Week of ${mondayStr}`, htmlContent);

    return NextResponse.json({
      success: true,
      week_of: mondayStr,
      events_count: (weekEvents || []).length,
      completed_count: (completedItems || []).length,
      overdue_count: (overdueItems || []).length,
      dark_clients_count: darkClients.length,
      pipeline_count: (pipelineEngagements || []).length,
    });
  } catch (error) {
    console.error('Weekly briefing error:', error);
    return NextResponse.json(
      { error: 'Weekly briefing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

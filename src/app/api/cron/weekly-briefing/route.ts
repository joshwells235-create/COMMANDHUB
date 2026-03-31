import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getBusinessContext } from '@/lib/business-context';
import { sendEmail } from '@/lib/resend';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Time ranges
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString();
    const sevenDaysAgoDate = sevenDaysAgo.toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
    const twentyOneDaysAgo = new Date(now.getTime() - 21 * 86400000).toISOString();

    // Next week range
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    const nextMondayStr = nextMonday.toISOString().split('T')[0];
    const nextFriday = new Date(nextMonday);
    nextFriday.setDate(nextFriday.getDate() + 5);
    const nextFridayStr = nextFriday.toISOString().split('T')[0];

    // ========================================
    // WEEK IN NUMBERS
    // ========================================

    // Sessions held this week (transcripts)
    const { data: weekTranscripts } = await supabase
      .from('transcripts')
      .select('id, org_id, transcript_date, organizations(id, name)')
      .gte('transcript_date', sevenDaysAgoDate)
      .order('transcript_date', { ascending: false });

    // Commitments created this week
    const { data: weekCommitmentsCreated } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, org_id, organizations(id, name)')
      .gte('created_at', sevenDaysAgoStr);

    // Commitments completed this week
    const { data: weekCommitmentsCompleted } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, completed_at, org_id, organizations(id, name)')
      .eq('status', 'completed')
      .gte('completed_at', sevenDaysAgoStr)
      .order('completed_at', { ascending: false });

    // Emails processed this week
    const { data: weekEmails } = await supabase
      .from('review_emails')
      .select('id, org_id')
      .gte('received_at', sevenDaysAgoStr);

    // Calendar events this past week
    const { data: weekEvents } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, org_id, organizations(id, name)')
      .gte('start_time', sevenDaysAgoStr)
      .lt('start_time', now.toISOString())
      .order('start_time', { ascending: true });

    // ========================================
    // CLIENT HEALTH DASHBOARD
    // ========================================
    const { data: activeOrgs } = await supabase
      .from('organizations')
      .select('id, name, strategic_value, status')
      .in('status', ['active', 'prospect'])
      .eq('is_own_business', false);

    interface ClientHealth {
      name: string;
      strategic_value: string;
      days_since_contact: number;
      last_contact_type: string;
      overdue_count: number;
      pending_count: number;
      completed_this_week: number;
      sessions_this_week: number;
      health_status: 'thriving' | 'healthy' | 'cooling' | 'at_risk';
    }

    const clientHealthData: ClientHealth[] = [];

    for (const org of activeOrgs || []) {
      // Last transcript
      const { data: lastTranscript } = await supabase
        .from('transcripts')
        .select('transcript_date')
        .eq('org_id', org.id)
        .order('transcript_date', { ascending: false })
        .limit(1);

      // Last email
      const { data: lastEmail } = await supabase
        .from('review_emails')
        .select('received_at')
        .eq('org_id', org.id)
        .order('received_at', { ascending: false })
        .limit(1);

      // Last calendar event (past only)
      const { data: lastEvent } = await supabase
        .from('calendar_events')
        .select('start_time')
        .eq('org_id', org.id)
        .lt('start_time', now.toISOString())
        .order('start_time', { ascending: false })
        .limit(1);

      // Overdue items
      const { data: orgOverdue } = await supabase
        .from('commitments')
        .select('id')
        .eq('org_id', org.id)
        .in('status', ['pending', 'in_progress'])
        .lt('due_date', todayStr);

      // Pending items
      const { data: orgPending } = await supabase
        .from('commitments')
        .select('id')
        .eq('org_id', org.id)
        .in('status', ['pending', 'in_progress']);

      // Completed this week
      const orgCompletedThisWeek = (weekCommitmentsCompleted || []).filter((c) => c.org_id === org.id).length;

      // Sessions this week
      const orgSessionsThisWeek = (weekTranscripts || []).filter((t) => t.org_id === org.id).length;

      // Calculate days since contact
      const dates: { date: Date; type: string }[] = [];
      if (lastTranscript?.[0]) dates.push({ date: new Date(lastTranscript[0].transcript_date), type: 'session' });
      if (lastEmail?.[0]) dates.push({ date: new Date(lastEmail[0].received_at), type: 'email' });
      if (lastEvent?.[0]) dates.push({ date: new Date(lastEvent[0].start_time), type: 'meeting' });

      const latest = dates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      const daysSince = latest
        ? Math.floor((now.getTime() - latest.date.getTime()) / 86400000)
        : 999;

      const overdueCount = (orgOverdue || []).length;
      const pendingCount = (orgPending || []).length;

      // Determine health status
      let healthStatus: ClientHealth['health_status'];
      if (daysSince <= 7 && overdueCount === 0) {
        healthStatus = 'thriving';
      } else if (daysSince <= 14 && overdueCount <= 1) {
        healthStatus = 'healthy';
      } else if (daysSince <= 21 || (daysSince <= 14 && overdueCount > 1)) {
        healthStatus = 'cooling';
      } else {
        healthStatus = 'at_risk';
      }

      clientHealthData.push({
        name: org.name,
        strategic_value: org.strategic_value,
        days_since_contact: daysSince,
        last_contact_type: latest?.type || 'never',
        overdue_count: overdueCount,
        pending_count: pendingCount,
        completed_this_week: orgCompletedThisWeek,
        sessions_this_week: orgSessionsThisWeek,
        health_status: healthStatus,
      });
    }

    // Sort: at_risk first, then cooling, then by strategic value
    const healthOrder: Record<string, number> = { at_risk: 0, cooling: 1, healthy: 2, thriving: 3 };
    const valueOrder: Record<string, number> = { strategic: 0, emerging: 1, standard: 2 };
    clientHealthData.sort((a, b) => {
      const healthDiff = (healthOrder[a.health_status] ?? 4) - (healthOrder[b.health_status] ?? 4);
      if (healthDiff !== 0) return healthDiff;
      return (valueOrder[a.strategic_value] ?? 3) - (valueOrder[b.strategic_value] ?? 3);
    });

    // ========================================
    // ALL OVERDUE (for watch list)
    // ========================================
    const { data: allOverdue } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, owner, created_at, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', todayStr)
      .order('due_date', { ascending: true });

    // Aging commitments (pending for 14+ days regardless of due date)
    const { data: agingCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, owner, created_at, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .lt('created_at', fourteenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(10);

    // ========================================
    // NEXT WEEK: events and upcoming commitments
    // ========================================
    const { data: nextWeekEvents } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, end_time, location, org_id, organizations(id, name)')
      .gte('start_time', `${nextMondayStr}T00:00:00`)
      .lt('start_time', `${nextFridayStr}T00:00:00`)
      .order('start_time', { ascending: true });

    const { data: nextWeekCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, priority_score, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .gte('due_date', nextMondayStr)
      .lte('due_date', nextFridayStr)
      .order('due_date', { ascending: true });

    // ========================================
    // PIPELINE
    // ========================================
    const { data: pipelineEngagements } = await supabase
      .from('engagements')
      .select('id, name, status, value_amount, organizations(id, name)')
      .eq('status', 'active')
      .not('value_amount', 'is', null);

    // ========================================
    // FORMAT DATA FOR CLAUDE
    // ========================================

    const formatOrg = (c: { organizations?: unknown }) => {
      const org = c.organizations as { id: string; name: string } | null;
      return org ? ` (${org.name})` : '';
    };

    // Week in numbers
    const sessionsCount = (weekTranscripts || []).length;
    const commitmentsCreatedCount = (weekCommitmentsCreated || []).length;
    const commitmentsCompletedCount = (weekCommitmentsCompleted || []).length;
    const emailsProcessedCount = (weekEmails || []).length;
    const meetingsCount = (weekEvents || []).length;

    const weekNumbersText = `Sessions held: ${sessionsCount}
Meetings attended: ${meetingsCount}
Commitments created: ${commitmentsCreatedCount}
Commitments completed: ${commitmentsCompletedCount}
Emails processed: ${emailsProcessedCount}
Completion rate: ${commitmentsCreatedCount > 0 ? Math.round((commitmentsCompletedCount / commitmentsCreatedCount) * 100) : 0}%`;

    // Client health
    const clientHealthText = clientHealthData.map((c) => {
      const emoji = { thriving: 'THRIVING', healthy: 'HEALTHY', cooling: 'COOLING', at_risk: 'AT RISK' }[c.health_status];
      return `- ${c.name} (${c.strategic_value}) | Status: ${emoji} | ${c.days_since_contact}d since contact (${c.last_contact_type}) | ${c.overdue_count} overdue, ${c.pending_count} pending | ${c.sessions_this_week} sessions this week, ${c.completed_this_week} completed this week`;
    }).join('\n') || 'No active organizations.';

    // Wins
    const winsText = (weekCommitmentsCompleted || []).map((c) => {
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)}`;
    }).join('\n') || 'No completions this week.';

    // Overdue
    const overdueText = (allOverdue || []).map((c) => {
      const daysOverdue = Math.floor((now.getTime() - new Date(c.due_date!).getTime()) / 86400000);
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | ${daysOverdue} days overdue | Owner: ${c.owner}`;
    }).join('\n') || 'Nothing overdue.';

    // Aging
    const agingText = (agingCommitments || []).map((c) => {
      const daysOld = Math.floor((now.getTime() - new Date(c.created_at).getTime()) / 86400000);
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | ${daysOld} days old | Owner: ${c.owner}`;
    }).join('\n') || 'No aging commitments.';

    // Watch list clients (cooling + at_risk)
    const watchListClients = clientHealthData.filter((c) => c.health_status === 'cooling' || c.health_status === 'at_risk');
    const watchListText = watchListClients.map((c) => {
      return `- ${c.name} (${c.strategic_value}): ${c.health_status.toUpperCase()} — ${c.days_since_contact}d since contact, ${c.overdue_count} overdue`;
    }).join('\n') || 'All clients in good shape.';

    // Next week events
    const nextWeekEventsText = (nextWeekEvents || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      const start = new Date(e.start_time);
      const dayName = start.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
      const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `- ${dayName} ${time}: ${e.subject || 'No subject'}${org ? ` (${org.name})` : ''}`;
    }).join('\n') || 'No events scheduled.';

    // Next week commitments
    const nextWeekCommitmentsText = (nextWeekCommitments || []).map((c) => {
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | Due: ${c.due_date}`;
    }).join('\n') || 'No commitments due next week.';

    // Pipeline
    const pipelineText = (pipelineEngagements || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      return `- ${e.name}${org ? ` (${org.name})` : ''}: $${(e.value_amount || 0).toLocaleString()}`;
    }).join('\n') || 'No active pipeline items.';

    // Revenue context from business_context profile
    const businessCtx = await getBusinessContext(supabase);
    const bizProfile = businessCtx.profile as Record<string, unknown> | null;
    const revenueModel = bizProfile?.revenue_model as Record<string, unknown> | undefined;
    const currentQuarter = revenueModel?.current_quarter as Record<string, unknown> | undefined;
    const activePriorities = bizProfile?.active_priorities as string[] | undefined;

    // Renewals coming due in next 60 days
    const sixtyDaysOut = new Date(now.getTime() + 60 * 86400000).toISOString();
    const { data: upcomingRenewals } = await supabase
      .from('engagements')
      .select('name, value_amount, end_date, organizations(name)')
      .eq('status', 'pending')
      .lte('end_date', sixtyDaysOut)
      .gte('end_date', now.toISOString())
      .order('end_date', { ascending: true })
      .limit(10);

    const renewalText = (upcomingRenewals || []).map((r) => {
      const org = r.organizations as unknown as { name: string } | null;
      return `- ${r.name}${org ? ` (${org.name})` : ''}: $${Number(r.value_amount || 0).toLocaleString()} due ${r.end_date}`;
    }).join('\n') || 'No renewals in the next 60 days.';

    const revenueContextText = currentQuarter
      ? `Quarterly target: $${Number(currentQuarter.target || 0).toLocaleString()}
Closed this quarter: $${Number(currentQuarter.closed || 0).toLocaleString()}
Gap: $${Number(currentQuarter.gap || 0).toLocaleString()}
Pace: ${currentQuarter.target ? Math.round((Number(currentQuarter.closed || 0) / Number(currentQuarter.target)) * 100) : 0}%`
      : '';

    const prioritiesText = (activePriorities || []).map((p) => `- ${p}`).join('\n') || '';

    // All transcripts this week for cross-client insights
    const sessionClientsThisWeek = [...new Set((weekTranscripts || []).map((t) => {
      const org = t.organizations as unknown as { id: string; name: string } | null;
      return org?.name;
    }).filter(Boolean))];

    const uniqueNextWeekOrgIds = [...new Set((nextWeekEvents || []).map((e) => e.org_id).filter(Boolean))];

    // ========================================
    // PERSONAL LIFE DATA
    // ========================================
    const { data: weekLifeLogs } = await supabase
      .from('life_logs')
      .select('title, tags, logged_at')
      .gte('logged_at', sevenDaysAgoStr)
      .order('logged_at', { ascending: false });

    const { data: goalsProfile } = await supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'personal_goals')
      .single();

    const { data: personalCommitmentsWeek } = await supabase
      .from('commitments')
      .select('title, status, completed_at')
      .eq('category', 'personal')
      .or(`status.in.(pending,in_progress),and(status.eq.completed,completed_at.gte.${sevenDaysAgoStr})`);

    const weekLogs = weekLifeLogs || [];
    const fitnessCount = weekLogs.filter(l => l.tags?.includes('fitness')).length;
    const goals = (goalsProfile?.profile_data as { goals?: Array<Record<string, unknown>> })?.goals || [];
    const fitnessGoal = goals.find(g => g.active && g.tracking_tag === 'fitness');
    const personalCompleted = (personalCommitmentsWeek || []).filter(c => c.status === 'completed').length;
    const personalOpen = (personalCommitmentsWeek || []).filter(c => c.status !== 'completed').length;

    const personalWeekText = [
      fitnessGoal ? `Fitness: ${fitnessCount}/${fitnessGoal.target} workouts this week` : null,
      personalCompleted > 0 ? `Personal items completed: ${personalCompleted}` : null,
      personalOpen > 0 ? `Personal items still open: ${personalOpen}` : null,
      ...goals.filter(g => g.active && g.type === 'milestone').map(g => {
        const milestones = g.milestones as string[] | undefined;
        const current = g.current_milestone as number;
        return `Goal: ${g.title} — ${milestones?.[current] || 'In progress'}`;
      }),
    ].filter(Boolean).join('\n') || 'No personal tracking data this week.';

    // ========================================
    // CALL CLAUDE
    // ========================================
    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are Josh Wells' chief of staff. Generate his weekly practice report email. This is sent on Sunday evening or early Monday morning to set up the week ahead. It should feel like a comprehensive but scannable debrief of the past week and preview of the next.

NOTE: "Leadshift" / "LeadShift" is Josh's OWN business — not a client. Distinguish between internal LeadShift business activities (team meetings, sales strategy, ops) and client-facing work. LeadShift items should appear under internal/business sections, not mixed in with client work.

REPORTING PERIOD: Past 7 days ending ${todayStr}

WEEK IN NUMBERS:
${weekNumbersText}

CLIENT HEALTH DASHBOARD (${(activeOrgs || []).length} active clients):
${clientHealthText}

WINS THIS WEEK (${commitmentsCompletedCount} completions):
${winsText}

OVERDUE ITEMS (${(allOverdue || []).length} total):
${overdueText}

AGING COMMITMENTS (14+ days old, still pending):
${agingText}

WATCH LIST CLIENTS (cooling or at risk):
${watchListText}

SESSIONS THIS WEEK: ${sessionsCount} sessions with ${sessionClientsThisWeek.length} clients (${sessionClientsThisWeek.join(', ') || 'none'})

NEXT WEEK: ${(nextWeekEvents || []).length} events across ${uniqueNextWeekOrgIds.length} clients
${nextWeekEventsText}

NEXT WEEK COMMITMENTS DUE:
${nextWeekCommitmentsText}

PIPELINE:
${pipelineText}

PERSONAL LIFE (this week):
${personalWeekText}
${revenueContextText ? `
REVENUE CONTEXT:
${revenueContextText}` : ''}
${renewalText !== 'No renewals in the next 60 days.' ? `
RENEWALS DUE (next 60 days):
${renewalText}` : ''}
${prioritiesText ? `
ACTIVE BUSINESS PRIORITIES:
${prioritiesText}` : ''}

Generate the email as complete HTML with inline CSS. The design MUST follow these rules:
- Dark theme: background #0f172a, card backgrounds #1e293b, text #e2e8f0, muted text #94a3b8
- Accent colors: blue #3b82f6, green #22c55e for positive/wins, amber #f59e0b for warnings, red #ef4444 for at-risk/overdue, purple #a855f7 for insights
- Mobile-first: max-width 640px, centered, padding 16px on cards
- Table-based layout for email compatibility
- No images, no external resources
- Cards with border-radius: 8px, left border 4px color-coded by section
- Section headers: uppercase, 12px, letter-spaced, muted color
- Key numbers should be large (24-32px) and bold for scannability

Structure the email with these exact sections in this order:

1. **Header**: "Weekly Practice Report" with the date range (e.g., "March 21 - March 28, 2026"). A one-line executive summary of the week.

2. **Week in Numbers**: A clean grid showing key metrics as big numbers with labels beneath:
   - Sessions held
   - Commitments created
   - Commitments completed
   - Emails processed
   Show completion rate as a percentage. Use green if >= 70%, amber if 40-69%, red if < 40%.

3. **Client Health Dashboard**: A compact table or card list of ALL active clients with:
   - Client name
   - Health status badge (THRIVING = green, HEALTHY = blue, COOLING = amber, AT RISK = red)
   - Days since contact
   - Overdue item count (if any)
   - Brief one-liner context per client
   Sort: at-risk first, then cooling, then healthy, then thriving.

4. **Wins This Week**: Completed commitments listed with green checkmarks. Group by client if possible. If no wins, skip section entirely.

5. **Watch List**: Two sub-sections:
   - Clients going cold or at risk (with specific recommended actions)
   - Commitments aging out (14+ days old, still pending)
   Only show if there are items. Use amber/red color coding.

6. **Cross-Client Insight**: Based on ALL the data above, identify ONE meaningful pattern or observation across Josh's practice this week. This should be genuinely insightful — not obvious. For example: "Three of your four sessions this week involved scope discussions — you may be in a phase where clients are re-evaluating engagements" or "Your completion rate dropped but creation rate spiked — looks like you're in a planning phase." Use a purple left border for this card. 2-3 sentences max.

7. **Personal Scorecard** (ONLY if PERSONAL LIFE data is provided above): Green left border. Show fitness progress, personal items completed vs open, and milestone goal status. Brief and warm — not a report card. If no data, skip entirely.

8. **Revenue Pulse** (ONLY if REVENUE CONTEXT data is provided above): Show quarterly pace vs target with a simple text progress bar. List renewals due in the next 60 days with amounts. Flag any active business priorities that are time-sensitive. Purple left border. Keep it compact — 4-5 lines max.

9. **Next Week Outlook**:
   - Calendar overview (events by day)
   - Commitments due next week
   - Suggested priorities based on what's overdue, what's due, and client health
   - If the week looks heavy, say so. If light, note the opportunity.

10. **Footer**: Brief sign-off with a forward-looking one-liner. Contextual, not generic.

Important rules:
- If a section has no data, SKIP IT ENTIRELY
- Keep the entire email under 1200 words of visible text
- Use generous spacing between sections
- Commitment types should be human-readable (promise_made -> "Promise", follow_up -> "Follow-up", action_item -> "Action", deliverable -> "Deliverable")
- The cross-client insight should be genuinely thoughtful — do not be generic or use corporate speak
- Never use the word "synergy" or similar buzzwords
- Tone: authoritative but warm, like a weekly partner meeting debrief
- Output ONLY the HTML, no markdown fences, no explanation
- The HTML should start with <!DOCTYPE html> and be a complete valid email document`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    let htmlContent = textContent.text;
    // Strip markdown fences if Claude included them
    htmlContent = htmlContent.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');

    // Send via Resend
    const weekLabel = `${sevenDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const recipient = process.env.JOSH_EMAIL || 'josh@example.com';
    await sendEmail(recipient, `Weekly Practice Report — ${weekLabel}`, htmlContent);

    const summary = {
      week_ending: todayStr,
      sessions_count: sessionsCount,
      commitments_created: commitmentsCreatedCount,
      commitments_completed: commitmentsCompletedCount,
      emails_processed: emailsProcessedCount,
      meetings_count: meetingsCount,
      active_clients: (activeOrgs || []).length,
      at_risk_clients: clientHealthData.filter((c) => c.health_status === 'at_risk').length,
      cooling_clients: clientHealthData.filter((c) => c.health_status === 'cooling').length,
      overdue_count: (allOverdue || []).length,
      next_week_events: (nextWeekEvents || []).length,
    };

    // Store in briefings table
    await supabase.from('briefings').insert({
      briefing_type: 'weekly',
      html_content: htmlContent,
      summary,
    });

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('Weekly briefing error:', error);
    return NextResponse.json(
      { error: 'Weekly briefing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

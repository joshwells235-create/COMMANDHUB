import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const twentyFourHoursAgo = new Date(today.getTime() - 86400000).toISOString();
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000).toISOString();

    // 1. Fetch today's calendar events
    const { data: events } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, end_time, location, ai_analysis, org_id, organizations(id, name)')
      .gte('start_time', `${todayStr}T00:00:00`)
      .lt('start_time', `${tomorrowStr}T00:00:00`)
      .order('start_time', { ascending: true });

    // 2. Overdue commitments (Josh owns)
    const { data: overdueCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, priority_score, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .eq('owner', 'josh')
      .lt('due_date', todayStr)
      .order('due_date', { ascending: true });

    // 3. Due today (Josh owns)
    const { data: dueTodayCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, priority_score, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .eq('owner', 'josh')
      .eq('due_date', todayStr)
      .order('priority_score', { ascending: false });

    // 4. Items others owe Josh (waiting on others)
    const { data: waitingOnOthers } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, other_party, created_at, organizations(id, name)')
      .eq('status', 'waiting')
      .neq('owner', 'josh')
      .order('created_at', { ascending: true })
      .limit(10);

    // 5. Recently completed (last 24 hours)
    const { data: recentlyCompleted } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, completed_at, organizations(id, name)')
      .eq('status', 'completed')
      .gte('completed_at', twentyFourHoursAgo)
      .order('completed_at', { ascending: false });

    // 6. Top priorities (Josh owns, not overdue, not due today)
    const { data: topPriorities } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, priority_score, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .eq('owner', 'josh')
      .or(`due_date.gt.${todayStr},due_date.is.null`)
      .order('priority_score', { ascending: false })
      .limit(5);

    // 7. Emails needing reply
    const { data: replyEmails } = await supabase
      .from('review_emails')
      .select('id, sender, subject, received_at, ai_extraction')
      .eq('is_processed', true)
      .limit(30);

    const needsReply = (replyEmails || []).filter((e) => {
      const extraction = e.ai_extraction as { needs_reply?: boolean; reply_urgency?: string } | null;
      return extraction?.needs_reply === true;
    });

    // 8. Relationship alerts: all active orgs, days since last transcript/email/event
    const { data: activeOrgs } = await supabase
      .from('organizations')
      .select('id, name, strategic_value, status')
      .in('status', ['active', 'prospect']);

    interface RelationshipAlert {
      name: string;
      strategic_value: string;
      days_since_contact: number;
      last_contact_type: string;
      overdue_count: number;
    }

    const relationshipAlerts: RelationshipAlert[] = [];
    const orgContactMap: Map<string, { days: number; lastType: string; overdueCount: number }> = new Map();

    for (const org of activeOrgs || []) {
      // Find last transcript
      const { data: lastTranscript } = await supabase
        .from('transcripts')
        .select('transcript_date')
        .eq('org_id', org.id)
        .order('transcript_date', { ascending: false })
        .limit(1);

      // Find last email
      const { data: lastEmail } = await supabase
        .from('review_emails')
        .select('received_at')
        .eq('org_id', org.id)
        .order('received_at', { ascending: false })
        .limit(1);

      // Find last calendar event (past only)
      const { data: lastEvent } = await supabase
        .from('calendar_events')
        .select('start_time')
        .eq('org_id', org.id)
        .lt('start_time', today.toISOString())
        .order('start_time', { ascending: false })
        .limit(1);

      // Count overdue items for this org
      const { data: orgOverdue } = await supabase
        .from('commitments')
        .select('id')
        .eq('org_id', org.id)
        .in('status', ['pending', 'in_progress'])
        .lt('due_date', todayStr);

      const dates: { date: Date; type: string }[] = [];
      if (lastTranscript?.[0]) dates.push({ date: new Date(lastTranscript[0].transcript_date), type: 'session' });
      if (lastEmail?.[0]) dates.push({ date: new Date(lastEmail[0].received_at), type: 'email' });
      if (lastEvent?.[0]) dates.push({ date: new Date(lastEvent[0].start_time), type: 'meeting' });

      const latest = dates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      const daysSince = latest
        ? Math.floor((today.getTime() - latest.date.getTime()) / 86400000)
        : 999;

      const overdueCount = (orgOverdue || []).length;

      orgContactMap.set(org.id, { days: daysSince, lastType: latest?.type || 'never', overdueCount });

      if (daysSince >= 14) {
        relationshipAlerts.push({
          name: org.name,
          strategic_value: org.strategic_value,
          days_since_contact: daysSince,
          last_contact_type: latest?.type || 'never',
          overdue_count: overdueCount,
        });
      }
    }

    // Sort alerts by strategic value first, then days
    relationshipAlerts.sort((a, b) => {
      const valueOrder: Record<string, number> = { strategic: 0, emerging: 1, standard: 2 };
      const valueDiff = (valueOrder[a.strategic_value] ?? 3) - (valueOrder[b.strategic_value] ?? 3);
      if (valueDiff !== 0) return valueDiff;
      return b.days_since_contact - a.days_since_contact;
    });

    // --- Format all data as text for Claude ---

    const formatOrg = (c: { organizations?: unknown }) => {
      const org = c.organizations as { id: string; name: string } | null;
      return org ? ` (${org.name})` : '';
    };

    const eventsText = (events || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      const analysis = e.ai_analysis as { prep_notes?: string; event_type?: string } | null;
      const start = new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      const end = new Date(e.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `- ${start}-${end}: ${e.subject || 'No subject'}${org ? ` (${org.name})` : ''}${e.location ? ` @ ${e.location}` : ''}${analysis?.prep_notes ? ` | Prep: ${analysis.prep_notes}` : ''}${analysis?.event_type ? ` | Type: ${analysis.event_type}` : ''}`;
    }).join('\n') || 'No events scheduled today.';

    const overdueText = (overdueCommitments || []).map((c) => {
      const daysOverdue = Math.floor((today.getTime() - new Date(c.due_date!).getTime()) / 86400000);
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | ${daysOverdue} days overdue | Score: ${c.priority_score}`;
    }).join('\n') || 'Nothing overdue.';

    const dueTodayText = (dueTodayCommitments || []).map((c) => {
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | Score: ${c.priority_score}`;
    }).join('\n') || 'Nothing due today.';

    const waitingText = (waitingOnOthers || []).map((c) => {
      const daysWaiting = Math.floor((today.getTime() - new Date(c.created_at).getTime()) / 86400000);
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)} | Waiting on: ${c.other_party || 'someone'} | ${daysWaiting} days`;
    }).join('\n') || 'Nothing waiting on others.';

    const completedText = (recentlyCompleted || []).map((c) => {
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)}`;
    }).join('\n') || 'Nothing completed in last 24h.';

    const prioritiesText = (topPriorities || []).map((c) => {
      return `- [${c.commitment_type}] ${c.title}${formatOrg(c)}${c.due_date ? ` | Due: ${c.due_date}` : ''} | Score: ${c.priority_score}`;
    }).join('\n') || 'No upcoming priorities.';

    const alertsText = relationshipAlerts.map((a) => {
      return `- ${a.name} (${a.strategic_value}): ${a.days_since_contact} days since last ${a.last_contact_type}${a.overdue_count > 0 ? `, ${a.overdue_count} overdue items` : ''}`;
    }).join('\n') || 'All clients have recent touchpoints.';

    const replyText = needsReply.map((e) => {
      const extraction = e.ai_extraction as { reply_urgency?: string } | null;
      return `- From: ${e.sender || 'Unknown'} | Subject: ${e.subject} | Urgency: ${extraction?.reply_urgency || 'unknown'}`;
    }).join('\n') || 'No replies needed.';

    // Build the "who needs attention" data for Claude
    const orgAttentionData = (activeOrgs || []).map((org) => {
      const contact = orgContactMap.get(org.id);
      if (!contact) return null;
      return {
        name: org.name,
        strategic_value: org.strategic_value,
        days_since_contact: contact.days,
        overdue_count: contact.overdueCount,
      };
    }).filter(Boolean);

    const attentionDataText = orgAttentionData.map((o) => {
      if (!o) return '';
      return `- ${o.name} (${o.strategic_value}): ${o.days_since_contact} days since contact, ${o.overdue_count} overdue items`;
    }).join('\n');

    // --- Call Claude to generate the briefing ---
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are Josh Wells' chief of staff. Generate his morning briefing email for ${todayStr}. This is the first thing he reads at 7am over coffee on his phone. Make it genuinely useful, crisp, and actionable.

TODAY'S SCHEDULE (${(events || []).length} events):
${eventsText}

OVERDUE COMMITMENTS (${(overdueCommitments || []).length} items):
${overdueText}

DUE TODAY (${(dueTodayCommitments || []).length} items):
${dueTodayText}

WAITING ON OTHERS (${(waitingOnOthers || []).length} items):
${waitingText}

COMPLETED LAST 24H (${(recentlyCompleted || []).length} items — momentum):
${completedText}

UPCOMING PRIORITIES:
${prioritiesText}

RELATIONSHIP ALERTS (14+ days no contact):
${alertsText}

EMAILS NEEDING REPLY:
${replyText}

CLIENT ATTENTION DATA (all active orgs):
${attentionDataText}

Generate the email as complete HTML with inline CSS. The design MUST follow these rules:
- Dark theme: background #0f172a, card backgrounds #1e293b, text #e2e8f0, accent blue #3b82f6, accent green #22c55e for wins, accent amber #f59e0b for warnings, accent red #ef4444 for urgent/overdue
- Mobile-first: max-width 600px, centered, good padding
- Use a table-based layout for email compatibility
- No images, no external resources

Structure the email with these exact sections in this order:

1. **Header**: "Good morning, Josh" with today's date. A one-line weather-report-style summary of the day (e.g., "3 meetings, 2 overdue items, 1 client going cold").

2. **The One Thing**: Based on ALL the data above, pick THE single most important thing Josh should focus on today. Display it prominently. Explain why in 1-2 sentences. Be specific and actionable, not generic.

3. **Today's Schedule**: Clean timeline of events. For each event tied to a client, add a one-liner "meeting prep teaser" — something useful to remember about that client based on commitments, overdue items, or relationship status. If no events, say so briefly.

4. **Commitment Pulse**:
   - Overdue items with a red indicator and days overdue count
   - Due today items
   - Waiting on others (what Josh is owed)
   - If there are completed items in the last 24h, show them with a green checkmark for momentum

5. **Who Needs Attention**: Based on commitment age, overdue items, and contact recency, list 1-3 clients that need proactive outreach today. For each, give a specific suggested action. Only include this section if there are clients that genuinely need attention.

6. **Relationship Alerts**: Clients going cold (14+ days no contact). Only show if there are any.

7. **Replies Needed**: Emails awaiting response, grouped by urgency. Only show if there are any.

8. **Footer**: A brief motivational or grounding sign-off. Keep it real, not cheesy.

Important rules:
- If a section has no data, either skip it entirely or show a brief positive note (e.g., "All caught up on replies")
- Keep the entire email under 800 words of visible text
- Use spacing and subtle dividers between sections for scannability
- Commitment types should be human-readable (promise_made -> "Promise", follow_up -> "Follow-up", etc.)
- Output ONLY the HTML, no markdown fences, no explanation`,
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
    const recipient = process.env.JOSH_EMAIL || 'josh@example.com';
    await sendEmail(recipient, `Morning Briefing — ${todayStr}`, htmlContent);

    return NextResponse.json({
      success: true,
      date: todayStr,
      events_count: (events || []).length,
      overdue_count: (overdueCommitments || []).length,
      due_today_count: (dueTodayCommitments || []).length,
      waiting_on_others_count: (waitingOnOthers || []).length,
      completed_24h_count: (recentlyCompleted || []).length,
      relationship_alerts_count: relationshipAlerts.length,
      replies_needed: needsReply.length,
    });
  } catch (error) {
    console.error('Morning briefing error:', error);
    return NextResponse.json(
      { error: 'Morning briefing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

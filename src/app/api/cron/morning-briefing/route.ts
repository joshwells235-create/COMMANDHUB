import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
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
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const twentyFourHoursAgo = new Date(today.getTime() - 86400000).toISOString();

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

    // 9. Fetch recent commitments for meeting-related orgs (for meeting prep context)
    const meetingOrgIds = (events || []).map((e) => e.org_id).filter(Boolean) as string[];
    const uniqueMeetingOrgIds = [...new Set(meetingOrgIds)];

    const meetingPrepData: Record<string, { commitments: string[]; contactInfo: { days: number; lastType: string } }> = {};
    for (const orgId of uniqueMeetingOrgIds) {
      const { data: orgCommitments } = await supabase
        .from('commitments')
        .select('id, title, commitment_type, status, due_date, owner')
        .eq('org_id', orgId)
        .in('status', ['pending', 'in_progress', 'waiting'])
        .order('priority_score', { ascending: false })
        .limit(5);

      const contact = orgContactMap.get(orgId);
      meetingPrepData[orgId] = {
        commitments: (orgCommitments || []).map((c) => {
          const overdue = c.due_date && new Date(c.due_date) < today ? ' (OVERDUE)' : '';
          return `[${c.commitment_type}] ${c.title} - ${c.status}${overdue} (owner: ${c.owner})`;
        }),
        contactInfo: contact || { days: 0, lastType: 'unknown' },
      };
    }

    // 10. Fetch theme alerts (urgent + pattern severity)
    const { data: themeAlertsProfile } = await supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'theme_alerts')
      .single();

    interface ThemeAlertItem {
      theme: string;
      description: string;
      clients_affected: { org_id: string; org_name: string }[];
      frequency: number;
      opportunity: string;
      severity: string;
    }

    const themeAlertsData = themeAlertsProfile?.profile_data as {
      themes?: ThemeAlertItem[];
      coaching_opportunity?: string | null;
      blind_spot_alert?: string | null;
    } | null;

    const activeThemeAlerts = (themeAlertsData?.themes || []).filter(
      (t: ThemeAlertItem) => t.severity === 'urgent' || t.severity === 'pattern'
    );

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
      const prepContext = org && e.org_id && meetingPrepData[e.org_id]
        ? `\n  Open items for ${org.name}: ${meetingPrepData[e.org_id].commitments.join('; ') || 'None'}\n  Last contact: ${meetingPrepData[e.org_id].contactInfo.days} days ago via ${meetingPrepData[e.org_id].contactInfo.lastType}`
        : '';
      return `- ${start}-${end}: ${e.subject || 'No subject'}${org ? ` (${org.name})` : ''}${e.location ? ` @ ${e.location}` : ''}${analysis?.prep_notes ? ` | Prep: ${analysis.prep_notes}` : ''}${analysis?.event_type ? ` | Type: ${analysis.event_type}` : ''}${prepContext}`;
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

    const themeAlertsText = activeThemeAlerts.length > 0
      ? activeThemeAlerts.map((t: ThemeAlertItem) => {
          const clientNames = t.clients_affected.map((c: { org_name: string }) => c.org_name).join(', ');
          return `- [${t.severity.toUpperCase()}] ${t.theme}: ${t.description} | Affects: ${clientNames} | Opportunity: ${t.opportunity}`;
        }).join('\n')
      : '';

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
      model: AI_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `You are Josh Wells' chief of staff. Generate his morning briefing email for ${todayStr} (${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}). This is the first thing he reads at 7am over coffee on his phone. Make it genuinely useful, crisp, and actionable. Think of it as a daily digest from someone who deeply understands his practice.

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

EMAILS NEEDING REPLY (${needsReply.length}):
${replyText}

CLIENT ATTENTION DATA (all active orgs):
${attentionDataText}
${activeThemeAlerts.length > 0 ? `
CROSS-CLIENT THEME ALERTS (${activeThemeAlerts.length} active):
${themeAlertsText}
${themeAlertsData?.coaching_opportunity ? `Coaching Opportunity: ${themeAlertsData.coaching_opportunity}` : ''}
` : ''}
Generate the email as complete HTML with inline CSS. The design MUST follow these rules:
- Dark theme: background #0f172a, card backgrounds #1e293b, text #e2e8f0, muted text #94a3b8, accent blue #3b82f6, accent green #22c55e for wins, accent amber #f59e0b for warnings, accent red #ef4444 for urgent/overdue
- Mobile-first: max-width 600px, centered, padding 16px on cards
- Use a table-based layout for email compatibility
- No images, no external resources
- Cards should have border-radius: 8px and a subtle left border (4px) color-coded by section type
- Section headers should be uppercase, small (12px), letter-spaced, in muted color (#94a3b8)
- Key numbers/counts should be large and bold for scannability

Structure the email with these exact sections in this order:

1. **Header**: "Good morning, Josh" with today's date formatted nicely (e.g., "Friday, March 28, 2026"). Below that, a one-line weather-report-style summary of the day ahead (e.g., "3 meetings, 2 overdue items, 1 client going cold"). This summary line should use colored pill-style badges for the counts.

2. **The One Thing**: THE single most important thing Josh should focus on today, based on ALL the data. Display it in a prominent card with a blue left border. The title should be specific and actionable (not generic like "clear your inbox"). Below the title, explain WHY in 1-2 sentences grounded in the actual data. This should be the thing that, if Josh only does one thing today, moves the needle the most.

3. **Today's Schedule**: Clean timeline of events with times in a monospace-style column on the left. For each event tied to a client, add a one-liner "meeting prep teaser" in muted text below the event name — something useful to remember (open commitments, how long since last session, anything overdue). If no events, show "Clear calendar today" briefly.

4. **Commitment Pulse**: Four sub-sections in a 2x2 grid if possible (or stacked on mobile):
   - OVERDUE: Red left border. Each item shows days overdue in a red badge. Commitment types human-readable (promise_made -> "Promise", follow_up -> "Follow-up", action_item -> "Action", deliverable -> "Deliverable", etc.)
   - DUE TODAY: Amber left border. Clean list.
   - WAITING ON OTHERS: Blue left border. Show who owes what and how many days you've been waiting.
   - MOMENTUM: Green left border. Recently completed items with checkmarks. If none, skip this sub-section.

5. **Who Needs Attention**: 1-3 clients that need proactive outreach today, based on the combination of: days since contact, overdue item count, and strategic value. For each client, give a SPECIFIC suggested action (e.g., "Send a quick check-in email" or "Follow up on the overdue proposal"). Show this section ONLY if there are clients that genuinely need attention — don't force it.

6. **Relationship Radar**: Clients going cold (14+ days no contact). Show as a compact list with days since contact and last contact type. Color-code: 14-21 days = amber, 21+ days = red. Only show if there are any.

7. **Theme Alerts** (ONLY if CROSS-CLIENT THEME ALERTS data is provided above): Show urgent and pattern-level themes that span multiple clients. For each, show the theme name, severity badge (red for urgent, amber for pattern), which clients are affected, and the recommended action. If a coaching opportunity exists, highlight it. Keep this section compact — 2-3 alerts max.

8. **Replies Needed**: Emails awaiting response. Sort by urgency (high first). Show sender and subject. Only show if there are any.

9. **Footer**: Brief, grounding sign-off. One line. Not motivational-poster cheesy — more like a thoughtful colleague. Examples of the right tone: "You've got a solid handle on things." or "Big day ahead — start with the one thing." Keep it contextual to the actual data above.

Important rules:
- If a section has no data, SKIP IT ENTIRELY (no empty state messages except for schedule)
- Keep the entire email under 900 words of visible text
- Use generous spacing (16px+ between sections) and subtle dividers (#1e293b colored hr) for scannability
- Commitment types should be human-readable (promise_made -> "Promise", follow_up -> "Follow-up", action_item -> "Action", deliverable -> "Deliverable")
- Never use the word "synergy" or any corporate buzzwords
- The tone should be direct, warm, and slightly informal — like a trusted colleague, not a robot
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

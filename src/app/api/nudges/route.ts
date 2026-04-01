import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

interface Nudge {
  id: string;
  type: 'meeting_prep' | 'going_cold' | 'unreplied_emails' | 'overdue_promise' | 'stale_waiting' | 'internal_overdue' | 'renewal_approaching' | 'habit_reminder' | 'personal_due';
  score: number;
  icon: 'calendar' | 'users' | 'mail' | 'alert-triangle' | 'clock' | 'heart' | 'target' | 'briefcase';
  title: string;
  subtitle: string;
  action_type: 'navigate' | 'complete' | 'draft';
  action_url: string;
  org_id: string | null;
  commitment_id: string | null;
  urgency: 'high' | 'medium' | 'low';
}

function urgencyFromScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = createServerClient();
    const now = new Date();
    const nudges: Nudge[] = [];

    // --- 1. Meeting Prep: client meetings in next 48 hours with overdue items ---
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const { data: rawUpcomingEvents } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, org_id, ai_analysis')
      .not('org_id', 'is', null)
      .gte('start_time', now.toISOString())
      .lte('start_time', in48h.toISOString())
      .order('start_time', { ascending: true });

    // Filter out personal events (Sleep, Deep Work, etc.)
    const upcomingEvents = (rawUpcomingEvents || []).filter((e) => {
      const analysis = e.ai_analysis as Record<string, unknown> | null;
      return analysis?.event_type !== 'personal';
    });

    if (upcomingEvents && upcomingEvents.length > 0) {
      // Gather unique org IDs from events
      const eventOrgIds = [...new Set(upcomingEvents.map(e => e.org_id).filter(Boolean))] as string[];

      // Fetch org names and filter out own-business
      const { data: eventOrgs } = await supabase
        .from('organizations')
        .select('id, name, is_own_business')
        .in('id', eventOrgIds)
        .eq('is_own_business', false);

      const orgNameMap = new Map((eventOrgs || []).map(o => [o.id, o.name]));

      // Fetch overdue commitment counts per org
      const { data: overdueCommitments } = await supabase
        .from('commitments')
        .select('id, org_id')
        .in('org_id', eventOrgIds)
        .in('status', ['pending', 'in_progress'])
        .lt('due_date', now.toISOString());

      const overdueByOrg = new Map<string, number>();
      for (const c of overdueCommitments || []) {
        if (c.org_id) {
          overdueByOrg.set(c.org_id, (overdueByOrg.get(c.org_id) || 0) + 1);
        }
      }

      // Also count pending (not overdue) commitments for context
      const { data: pendingCommitments } = await supabase
        .from('commitments')
        .select('id, org_id')
        .in('org_id', eventOrgIds)
        .in('status', ['pending', 'in_progress']);

      const pendingByOrg = new Map<string, number>();
      for (const c of pendingCommitments || []) {
        if (c.org_id) {
          pendingByOrg.set(c.org_id, (pendingByOrg.get(c.org_id) || 0) + 1);
        }
      }

      // Deduplicate by org_id (take earliest event per org)
      const seenOrgs = new Set<string>();
      for (const event of upcomingEvents) {
        if (!event.org_id || seenOrgs.has(event.org_id)) continue;
        seenOrgs.add(event.org_id);

        const orgName = orgNameMap.get(event.org_id) || 'Unknown';
        const overdueCount = overdueByOrg.get(event.org_id) || 0;
        const pendingCount = pendingByOrg.get(event.org_id) || 0;

        if (overdueCount === 0 && pendingCount === 0) continue;

        const eventDate = new Date(event.start_time);
        const isToday = eventDate.toDateString() === now.toDateString();
        const baseScore = isToday ? 100 : 80;
        const score = Math.min(baseScore + overdueCount * 5, 100);
        const when = isToday ? 'today' : 'tomorrow';
        const itemCount = overdueCount > 0 ? overdueCount : pendingCount;
        const itemLabel = overdueCount > 0 ? 'overdue items' : 'pending items';

        nudges.push({
          id: `meeting_prep_${event.org_id}`,
          type: 'meeting_prep',
          score,
          icon: 'calendar',
          title: `You meet with ${orgName} ${when} \u2014 ${itemCount} ${itemLabel} need attention`,
          subtitle: event.subject || 'Scheduled meeting',
          action_type: 'navigate',
          action_url: `/clients/${event.org_id}`,
          org_id: event.org_id,
          commitment_id: null,
          urgency: urgencyFromScore(score),
        });
      }
    }

    // --- 2. Going Cold: strategic clients with no contact >14 days ---
    const { data: strategicOrgs } = await supabase
      .from('organizations')
      .select('id, name, updated_at')
      .eq('status', 'active')
      .eq('is_own_business', false)
      .in('strategic_value', ['strategic', 'emerging']);

    if (strategicOrgs && strategicOrgs.length > 0) {
      const strategicOrgIds = strategicOrgs.map(o => o.id);

      // Most recent email per org
      const { data: recentEmails } = await supabase
        .from('emails')
        .select('org_id, received_at')
        .in('org_id', strategicOrgIds)
        .order('received_at', { ascending: false });

      const lastEmailByOrg = new Map<string, string>();
      for (const e of recentEmails || []) {
        if (e.org_id && !lastEmailByOrg.has(e.org_id)) {
          lastEmailByOrg.set(e.org_id, e.received_at);
        }
      }

      // Most recent transcript per org
      const { data: recentTranscripts } = await supabase
        .from('transcripts')
        .select('org_id, created_at')
        .in('org_id', strategicOrgIds)
        .order('created_at', { ascending: false });

      const lastTranscriptByOrg = new Map<string, string>();
      for (const t of recentTranscripts || []) {
        if (t.org_id && !lastTranscriptByOrg.has(t.org_id)) {
          lastTranscriptByOrg.set(t.org_id, t.created_at);
        }
      }

      // Most recent calendar event per org (past events only)
      const { data: recentCalEvents } = await supabase
        .from('calendar_events')
        .select('org_id, start_time')
        .in('org_id', strategicOrgIds)
        .lte('start_time', now.toISOString())
        .order('start_time', { ascending: false });

      const lastCalByOrg = new Map<string, string>();
      for (const c of recentCalEvents || []) {
        if (c.org_id && !lastCalByOrg.has(c.org_id)) {
          lastCalByOrg.set(c.org_id, c.start_time);
        }
      }

      for (const org of strategicOrgs) {
        const dates = [
          lastEmailByOrg.get(org.id),
          lastTranscriptByOrg.get(org.id),
          lastCalByOrg.get(org.id),
        ]
          .filter(Boolean)
          .map(d => new Date(d!).getTime());

        const lastContact = dates.length > 0 ? new Date(Math.max(...dates)) : null;
        if (!lastContact) continue;

        const daysSince = daysBetween(lastContact, now);
        if (daysSince < 14) continue;

        const score = Math.min(70 + (daysSince - 14) * 2, 95);

        nudges.push({
          id: `going_cold_${org.id}`,
          type: 'going_cold',
          score,
          icon: 'users',
          title: `${org.name} hasn't heard from you in ${daysSince} days`,
          subtitle: `Last contact: ${lastContact.toLocaleDateString()}`,
          action_type: 'navigate',
          action_url: `/clients/${org.id}`,
          org_id: org.id,
          commitment_id: null,
          urgency: urgencyFromScore(score),
        });
      }
    }

    // --- 3. Unreplied Emails ---
    const { data: unrepliedEmails } = await supabase
      .from('emails')
      .select('id, subject, sender, ai_extraction')
      .eq('folder', 'inbox')
      .eq('is_processed', true);

    if (unrepliedEmails && unrepliedEmails.length > 0) {
      let countToday = 0;
      let countThisWeek = 0;

      for (const email of unrepliedEmails) {
        const extraction = email.ai_extraction as Record<string, unknown> | null;
        if (!extraction) continue;
        if (String(extraction.needs_reply) !== 'true' && extraction.needs_reply !== true) continue;

        const urgency = String(extraction.reply_urgency || '');
        if (urgency === 'today') countToday++;
        else if (urgency === 'this_week') countThisWeek++;
      }

      const totalNeedReply = countToday + countThisWeek;
      if (totalNeedReply > 0) {
        const score = countToday > 0 ? 75 : 50;
        const urgentPart = countToday > 0 ? ` \u2014 ${countToday} urgent` : '';

        nudges.push({
          id: 'unreplied_emails',
          type: 'unreplied_emails',
          score,
          icon: 'mail',
          title: `${totalNeedReply} emails need replies${urgentPart}`,
          subtitle: countThisWeek > 0 ? `${countThisWeek} more due this week` : 'All flagged as urgent',
          action_type: 'navigate',
          action_url: '/review',
          org_id: null,
          commitment_id: null,
          urgency: urgencyFromScore(score),
        });
      }
    }

    // --- 4. Overdue Promise: promise_made commitments past due ---
    const { data: overduePromises } = await supabase
      .from('commitments')
      .select('id, title, other_party, due_date, org_id')
      .eq('commitment_type', 'promise_made')
      .eq('status', 'pending')
      .lt('due_date', now.toISOString())
      .order('due_date', { ascending: true });

    if (overduePromises && overduePromises.length > 0) {
      for (const promise of overduePromises) {
        const dueDate = new Date(promise.due_date!);
        const daysOverdue = daysBetween(dueDate, now);
        const score = Math.min(85 + daysOverdue * 3, 100);
        const party = promise.other_party || 'someone';

        nudges.push({
          id: `overdue_promise_${promise.id}`,
          type: 'overdue_promise',
          score,
          icon: 'alert-triangle',
          title: `You promised ${party}: '${promise.title}' \u2014 ${daysOverdue} days overdue`,
          subtitle: `Due: ${dueDate.toLocaleDateString()}`,
          action_type: 'complete',
          action_url: promise.org_id ? `/clients/${promise.org_id}` : '/commitments',
          org_id: promise.org_id,
          commitment_id: promise.id,
          urgency: urgencyFromScore(score),
        });
      }
    }

    // --- 5. Stale Waiting: items in 'waiting' status for 7+ days ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: staleWaiting } = await supabase
      .from('commitments')
      .select('id, title, other_party, created_at, org_id')
      .eq('status', 'waiting')
      .lt('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: true });

    if (staleWaiting && staleWaiting.length > 0) {
      for (const item of staleWaiting) {
        const createdDate = new Date(item.created_at);
        const daysWaiting = daysBetween(createdDate, now);
        const score = Math.min(40 + daysWaiting * 2, 70);
        const party = item.other_party || 'someone';

        nudges.push({
          id: `stale_waiting_${item.id}`,
          type: 'stale_waiting',
          score,
          icon: 'clock',
          title: `Still waiting on ${party} for '${item.title}' \u2014 ${daysWaiting} days`,
          subtitle: `Created: ${createdDate.toLocaleDateString()}`,
          action_type: 'navigate',
          action_url: item.org_id ? `/clients/${item.org_id}` : '/commitments',
          org_id: item.org_id,
          commitment_id: item.id,
          urgency: urgencyFromScore(score),
        });
      }
    }

    // --- 5b. Internal Overdue: internal commitments past due ---
    try {
      const { data: internalOverdue } = await supabase
        .from('commitments')
        .select('id, title, due_date')
        .eq('category', 'internal')
        .in('status', ['pending', 'in_progress'])
        .lt('due_date', now.toISOString())
        .not('due_date', 'is', null);

      const internalOverdueCount = internalOverdue?.length || 0;
      if (internalOverdueCount >= 2) {
        const oldestDue = internalOverdue!.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0];
        const daysOverdue = daysBetween(new Date(oldestDue.due_date!), now);
        const score = Math.min(40 + internalOverdueCount * 10, 80);

        nudges.push({
          id: 'internal_overdue',
          type: 'internal_overdue',
          score,
          icon: 'briefcase',
          title: `${internalOverdueCount} internal items overdue — team tasks can slip quietly`,
          subtitle: `Oldest: '${oldestDue.title}' (${daysOverdue} days overdue)`,
          action_type: 'navigate',
          action_url: '/commitments?category=internal&view=overdue',
          org_id: null,
          commitment_id: null,
          urgency: urgencyFromScore(score),
        });
      }
    } catch { /* internal nudges non-critical */ }

    // --- 6. Renewal Approaching: engagements with end_date within 30 days ---
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { data: approachingRenewals } = await supabase
      .from('engagements')
      .select('id, name, value_amount, end_date, org_id, organizations(name)')
      .eq('status', 'pending')
      .gte('end_date', now.toISOString())
      .lte('end_date', thirtyDaysOut.toISOString())
      .order('end_date', { ascending: true })
      .limit(5);

    for (const renewal of approachingRenewals || []) {
      if (!renewal.end_date) continue;
      const daysUntil = daysBetween(now, new Date(renewal.end_date));
      const amount = Number(renewal.value_amount) || 0;
      const orgName = (renewal.organizations as unknown as { name: string } | null)?.name || 'Unknown';
      const score = Math.min(90, 60 + (30 - daysUntil) * 2 + (amount > 10000 ? 10 : 0));

      nudges.push({
        id: `renewal_${renewal.id}`,
        type: 'renewal_approaching',
        score,
        icon: 'calendar',
        title: `${orgName} renewal due in ${daysUntil} days — $${amount.toLocaleString()}`,
        subtitle: renewal.name,
        action_type: 'navigate',
        action_url: renewal.org_id ? `/clients/${renewal.org_id}` : '/commitments',
        org_id: renewal.org_id,
        commitment_id: null,
        urgency: urgencyFromScore(score),
      });
    }

    // --- 7. Habit Reminder: check if fitness goal is falling behind ---
    try {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const [goalsRes, logsRes] = await Promise.all([
        supabase.from('josh_profile').select('profile_data').eq('profile_type', 'personal_goals').single(),
        supabase.from('life_logs').select('tags').gte('logged_at', weekStart.toISOString()),
      ]);

      const goals = (goalsRes.data?.profile_data as { goals?: Array<Record<string, unknown>> })?.goals || [];
      const weekLogs = logsRes.data || [];
      const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

      for (const goal of goals.filter(g => g.active && g.type === 'recurring' && g.frequency === 'weekly')) {
        const tag = goal.tracking_tag as string;
        const target = goal.target as number;
        const current = weekLogs.filter(l => l.tags?.includes(tag)).length;
        const expectedPace = Math.floor(target * (dayOfWeek / 7));

        // Behind pace and at least 2 days since needed
        if (current < expectedPace && dayOfWeek >= 2) {
          const remaining = target - current;
          const daysLeft = 7 - dayOfWeek;
          // Higher score in evening/weekend when personal matters more
          const hour = now.getHours();
          const timeBonus = (hour >= 17 || dayOfWeek === 0 || dayOfWeek === 6) ? 15 : 0;
          const score = Math.min(70, 35 + (expectedPace - current) * 10 + timeBonus);

          nudges.push({
            id: `habit_${goal.id}`,
            type: 'habit_reminder',
            score,
            icon: 'heart',
            title: `${goal.title}: ${current}/${target} this week — ${remaining} to go in ${daysLeft} days`,
            subtitle: `You're behind pace. Can you fit one in today?`,
            action_type: 'navigate',
            action_url: '/',
            org_id: null,
            commitment_id: null,
            urgency: remaining > daysLeft ? 'high' : 'medium',
          });
        }
      }
    } catch { /* personal nudges are non-critical */ }

    // --- 8. Personal Due: personal commitments due soon ---
    try {
      const twoDaysOut = new Date(now.getTime() + 2 * 86400000);
      const { data: personalDue } = await supabase
        .from('commitments')
        .select('id, title, due_date')
        .eq('category', 'personal')
        .in('status', ['pending', 'in_progress'])
        .not('due_date', 'is', null)
        .lte('due_date', twoDaysOut.toISOString())
        .order('due_date', { ascending: true })
        .limit(3);

      for (const c of personalDue || []) {
        const dueDate = new Date(c.due_date!);
        const isOverdue = dueDate < now;
        const isToday = dueDate.toDateString() === now.toDateString();
        const score = isOverdue ? 55 : isToday ? 45 : 35;

        nudges.push({
          id: `personal_${c.id}`,
          type: 'personal_due',
          score,
          icon: 'target',
          title: c.title,
          subtitle: isOverdue ? `Personal — ${Math.floor((now.getTime() - dueDate.getTime()) / 86400000)} days overdue` : isToday ? 'Personal — due today' : `Personal — due ${dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          action_type: 'navigate',
          action_url: '/commitments',
          org_id: null,
          commitment_id: c.id,
          urgency: isOverdue ? 'high' : isToday ? 'medium' : 'low',
        });
      }
    } catch { /* personal nudges are non-critical */ }

    // Sort by score descending, return top 5
    nudges.sort((a, b) => b.score - a.score);
    const topNudges = nudges.slice(0, 5);

    return NextResponse.json(topNudges);
  } catch (error) {
    console.error('Nudges fetch error:', error);
    return NextResponse.json([], { status: 200 });
  }
}

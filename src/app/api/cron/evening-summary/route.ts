import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const tomorrowDate = new Date(now.getTime() + 86400000);
    const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

    // What got completed today
    const { data: completedToday } = await supabase
      .from('commitments')
      .select('title, commitment_type, category, organizations(name)')
      .eq('status', 'completed')
      .gte('completed_at', todayStart)
      .order('completed_at', { ascending: false });

    // Tomorrow's calendar (exclude personal)
    const { data: tomorrowEvents } = await supabase
      .from('calendar_events')
      .select('subject, start_time, ai_analysis, org_id, organizations(name)')
      .gte('start_time', `${tomorrowStr}T00:00:00`)
      .lt('start_time', new Date(tomorrowDate.getTime() + 86400000).toISOString().split('T')[0] + 'T00:00:00')
      .order('start_time', { ascending: true });

    const businessEvents = (tomorrowEvents || []).filter(e => {
      const ai = e.ai_analysis as Record<string, unknown> | null;
      return ai?.event_type !== 'personal';
    });

    // Still overdue
    const { data: overdue } = await supabase
      .from('commitments')
      .select('title, category')
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', now.toISOString())
      .eq('owner', 'josh');

    // Life logs today
    const { data: todayLogs } = await supabase
      .from('life_logs')
      .select('title, tags')
      .gte('logged_at', todayStart);

    // Personal goals
    const { data: goalsProfile } = await supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'personal_goals')
      .single();

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const { data: weekLogs } = await supabase
      .from('life_logs')
      .select('tags')
      .gte('logged_at', weekStart.toISOString());

    const fitnessThisWeek = (weekLogs || []).filter(l => l.tags?.includes('fitness')).length;
    const goals = (goalsProfile?.profile_data as { goals?: Array<Record<string, unknown>> })?.goals || [];
    const fitnessGoal = goals.find(g => g.active && g.tracking_tag === 'fitness');
    const fitnessTarget = (fitnessGoal?.target as number) || 0;
    const workedOutToday = (todayLogs || []).some(l => l.tags?.includes('fitness'));

    // Format data for Claude
    const completedText = (completedToday || []).map(c => {
      const orgName = (c.organizations as unknown as { name: string } | null)?.name;
      const badge = c.category === 'internal' ? '[Internal]' : c.category === 'personal' ? '[Personal]' : orgName ? `[${orgName}]` : '';
      return `- ${c.title} ${badge}`;
    }).join('\n') || 'Nothing completed today.';

    const tomorrowText = businessEvents.map(e => {
      const orgName = (e.organizations as unknown as { name: string } | null)?.name;
      const time = new Date(e.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
      return `- ${time}: ${e.subject}${orgName ? ` (${orgName})` : ''}`;
    }).join('\n') || 'No meetings scheduled.';

    const overdueCount = overdue?.length || 0;
    const clientOverdue = overdue?.filter(c => c.category === 'client').length || 0;
    const internalOverdue = overdue?.filter(c => c.category === 'internal').length || 0;

    // Generate the evening summary
    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generate a brief evening wind-down summary email for Josh Wells. It's ${now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET on ${now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}.

This is a SHORT, warm email — 150-200 words max. Not a full briefing. Think of it as a gentle tap on the shoulder saying "good work today, here's what's ahead."

COMPLETED TODAY:
${completedText}

STILL OVERDUE: ${overdueCount} items (${clientOverdue} client, ${internalOverdue} internal)

TOMORROW:
${businessEvents.length} meetings
${tomorrowText}

PERSONAL:
Fitness this week: ${fitnessThisWeek}/${fitnessTarget || '?'}${workedOutToday ? ' (worked out today ✓)' : ' (no workout logged today)'}

Generate complete HTML email with inline CSS. Dark theme: bg #0f172a, cards #1e293b, text #e2e8f0, muted #94a3b8. Max-width 500px. Mobile-first.

Structure:
1. **Day's Done** header with completed count
2. **Tomorrow Preview** — meeting count + first meeting time/name
3. **Personal Check** — fitness status, one-liner
4. **Carry Forward** — if overdue items, brief mention (not a guilt trip)
5. **Sign-off** — warm, brief, contextual

Keep it encouraging, not overwhelming. This email should make Josh feel like he can close the laptop.
Output ONLY the HTML, no markdown fences.`,
      }],
    });

    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response');
    }

    const html = textContent.text;

    // Store in briefings table
    await supabase.from('briefings').insert({
      briefing_type: 'evening',
      html_content: html,
      summary: {
        completed_count: completedToday?.length || 0,
        overdue_count: overdueCount,
        tomorrow_meetings: businessEvents.length,
        fitness_week: `${fitnessThisWeek}/${fitnessTarget}`,
      },
    });

    // Send email
    await sendEmail(
      process.env.JOSH_EMAIL || 'josh@leadshift.com',
      `Evening Summary — ${completedToday?.length || 0} done, ${businessEvents.length} tomorrow`,
      html,
    );

    return NextResponse.json({
      success: true,
      completed: completedToday?.length || 0,
      overdue: overdueCount,
      tomorrowMeetings: businessEvents.length,
    });
  } catch (error) {
    console.error('Evening summary error:', error);
    return NextResponse.json({ error: 'Failed to generate evening summary' }, { status: 500 });
  }
}

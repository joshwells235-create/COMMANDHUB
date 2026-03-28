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
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

    // 1. Fetch today's calendar events
    const { data: events } = await supabase
      .from('calendar_events')
      .select('id, subject, start_time, end_time, location, ai_analysis, organizations(id, name)')
      .gte('start_time', `${todayStr}T00:00:00`)
      .lt('start_time', `${tomorrowStr}T00:00:00`)
      .order('start_time', { ascending: true });

    // 2. Top 5 commitments by priority_score
    const { data: topCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, priority_score, organizations(id, name)')
      .in('status', ['pending', 'in_progress'])
      .eq('owner', 'josh')
      .order('priority_score', { ascending: false })
      .limit(5);

    // 3. Commitments aging out (created >3 days ago, still pending, no due date or overdue)
    const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
    const { data: agingCommitments } = await supabase
      .from('commitments')
      .select('id, title, commitment_type, due_date, created_at, organizations(id, name)')
      .eq('status', 'pending')
      .lt('created_at', threeDaysAgo)
      .order('created_at', { ascending: true })
      .limit(10);

    // Filter to those with no due date or overdue
    const agingFiltered = (agingCommitments || []).filter((c) => {
      if (!c.due_date) return true;
      return new Date(c.due_date) < today;
    });

    // 4. Emails needing reply
    const { data: replyEmails } = await supabase
      .from('review_emails')
      .select('id, sender, subject, received_at, ai_extraction')
      .eq('is_processed', true)
      .limit(20);

    // Filter to those where ai_extraction indicates needs_reply
    const needsReply = (replyEmails || []).filter((e) => {
      const extraction = e.ai_extraction as { needs_reply?: boolean; reply_urgency?: string } | null;
      return extraction?.needs_reply === true;
    });

    // 5. Format with Claude
    const eventsText = (events || []).map((e) => {
      const org = e.organizations as unknown as { id: string; name: string } | null;
      const analysis = e.ai_analysis as { prep_notes?: string } | null;
      const start = new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      const end = new Date(e.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `- ${start}-${end}: ${e.subject || 'No subject'}${org ? ` (${org.name})` : ''}${e.location ? ` @ ${e.location}` : ''}${analysis?.prep_notes ? ` | Prep: ${analysis.prep_notes}` : ''}`;
    }).join('\n') || 'No events scheduled today.';

    const prioritiesText = (topCommitments || []).map((c) => {
      const org = c.organizations as unknown as { id: string; name: string } | null;
      return `- [${c.commitment_type}] ${c.title}${org ? ` (${org.name})` : ''}${c.due_date ? ` | Due: ${c.due_date}` : ''} | Score: ${c.priority_score}`;
    }).join('\n') || 'No active commitments.';

    const agingText = agingFiltered.map((c) => {
      const org = c.organizations as unknown as { id: string; name: string } | null;
      const daysOld = Math.floor((today.getTime() - new Date(c.created_at).getTime()) / 86400000);
      const overdue = c.due_date ? ` | OVERDUE since ${c.due_date}` : ' | No due date set';
      return `- ${c.title}${org ? ` (${org.name})` : ''} | ${daysOld} days old${overdue}`;
    }).join('\n') || 'Nothing aging out.';

    const replyText = needsReply.map((e) => {
      const extraction = e.ai_extraction as { reply_urgency?: string } | null;
      return `- From: ${e.sender || 'Unknown'} | Subject: ${e.subject} | Urgency: ${extraction?.reply_urgency || 'unknown'}`;
    }).join('\n') || 'No replies needed.';

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Generate a morning briefing email for Josh Wells. Today is ${todayStr}.

TODAY'S SCHEDULE:
${eventsText}

TOP PRIORITIES:
${prioritiesText}

ITEMS AGING OUT:
${agingText}

REPLY NEEDED:
${replyText}

Format as a clean, scannable HTML email. Use a dark theme (#0f172a background, #e2e8f0 text, #3b82f6 for accents). Keep it concise - Josh reads this on his phone at 6:30am. Use inline CSS styles only. Structure with clear section headers. No images.`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    const htmlContent = textContent.text;

    // 6. Send via Resend
    const recipient = process.env.JOSH_EMAIL || 'josh@example.com';
    await sendEmail(recipient, `Morning Briefing - ${todayStr}`, htmlContent);

    return NextResponse.json({
      success: true,
      events_count: (events || []).length,
      priorities_count: (topCommitments || []).length,
      aging_count: agingFiltered.length,
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

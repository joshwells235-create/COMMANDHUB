import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { ReviewEmail } from '@/types/database';

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch processed received emails that AI flagged as needs_reply
    // Exclude sent folder, dismissed/accepted/reviewed, and internal LeadShift emails
    const { data, error } = await supabase
      .from('emails')
      .select('*, organization:organizations(id, name, is_own_business)')
      .eq('is_processed', true)
      .not('review_status', 'in', '("dismissed","accepted","reviewed")')
      .neq('folder', 'sent')
      .order('received_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter for emails where AI extraction indicates needs_reply
    // Exclude: Josh's own emails, internal LeadShift team emails
    const needsReplyRaw = (data as (ReviewEmail & { organization?: { is_own_business?: boolean } })[]).filter(
      (email) =>
        email.ai_extraction?.needs_reply === true &&
        !isJoshSender(email.sender) &&
        !email.organization?.is_own_business // Skip internal LeadShift emails
    );

    // Now check reply tracking: if Josh already replied in the same conversation
    // thread AFTER this email, it no longer needs a reply
    if (needsReplyRaw.length === 0) {
      return NextResponse.json([]);
    }

    // Get conversation IDs from the needs-reply emails
    const conversationIds = needsReplyRaw
      .map((e) => e.conversation_id)
      .filter((id): id is string => !!id);

    // Fetch Josh's sent/reply emails in those conversations
    let joshReplies: { conversation_id: string; received_at: string }[] = [];
    if (conversationIds.length > 0) {
      const uniqueConvIds = [...new Set(conversationIds)];
      const { data: replies } = await supabase
        .from('emails')
        .select('conversation_id, received_at')
        .in('conversation_id', uniqueConvIds)
        .or('folder.eq.sent,sender.ilike.%Josh Wells%')
        .order('received_at', { ascending: false });

      joshReplies = replies || [];
    }

    // Build a map: conversation_id -> latest Josh reply timestamp
    const latestReplyByConv = new Map<string, Date>();
    for (const reply of joshReplies) {
      if (!reply.conversation_id) continue;
      const replyDate = new Date(reply.received_at);
      const existing = latestReplyByConv.get(reply.conversation_id);
      if (!existing || replyDate > existing) {
        latestReplyByConv.set(reply.conversation_id, replyDate);
      }
    }

    // Filter out emails where Josh already replied after them
    const needsReply = needsReplyRaw.filter((email) => {
      if (!email.conversation_id) return true; // No conversation tracking, keep it
      const latestReply = latestReplyByConv.get(email.conversation_id);
      if (!latestReply) return true; // Josh hasn't replied in this thread
      // If Josh replied AFTER this email, it no longer needs a reply — exclude it
      const emailDate = new Date(email.received_at);
      return emailDate > latestReply; // Only keep if email came AFTER Josh's last reply
    });

    return NextResponse.json(needsReply);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function isJoshSender(sender: string | null): boolean {
  if (!sender) return false;
  const s = sender.toLowerCase();
  return s.includes('josh wells') || s.includes('josh@leadshiftinc.com') || s.includes('jwells');
}

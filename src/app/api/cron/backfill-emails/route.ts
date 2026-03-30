import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchEmails, fetchSentEmails } from '@/lib/microsoft-graph';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * One-time backfill endpoint: fetches up to 30 days of emails from Microsoft Graph.
 * Stores them in DB with is_processed=false so the regular sync-email cron
 * will pick them up in batches of 5 for AI extraction.
 *
 * Usage: GET /api/cron/backfill-emails?key=CRON_SECRET&days=30
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = createServerClient();

    // Fetch up to 500 inbox + 500 sent emails from the lookback period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [inboxEmails, sentEmails]: [any[], any[]] = await Promise.all([
      fetchEmails(sinceDate, 500),
      fetchSentEmails(sinceDate, 500),
    ]);

    // Known no-reply / junk sender patterns
    const noReplySenders = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'notifications@', 'notify@', 'alerts@', 'updates@', 'news@', 'newsletter@', 'marketing@', 'info@', 'support@'];
    const junkSubjects = ['unsubscribe', 'your receipt', 'order confirmation', 'shipping confirmation', 'delivery notification', 'password reset', 'verify your email', 'activate your account', 'your subscription', 'weekly digest', 'daily digest', 'newsletter', 'webinar', 'invitation:'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function isJunk(email: any): boolean {
      const subject = ((email.subject as string) || '').toLowerCase();
      const senderAddr = ((email.from as { emailAddress?: { address?: string } })?.emailAddress?.address || '').toLowerCase();
      if (noReplySenders.some((s) => senderAddr.includes(s))) return true;
      if (junkSubjects.some((s) => subject.includes(s))) return true;
      if (subject.startsWith('accepted:') || subject.startsWith('declined:') || subject.startsWith('tentatively accepted:')) return true;
      return false;
    }

    let synced = 0;
    let junkSkipped = 0;
    let alreadyExists = 0;

    // Process inbox
    for (const email of inboxEmails) {
      const sender = email.from?.emailAddress as { name?: string; address?: string } | undefined;
      const recipients = [
        ...(email.toRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
          type: 'to',
        })),
        ...(email.ccRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
          type: 'cc',
        })),
      ];

      const junk = isJunk(email);
      if (junk) junkSkipped++;

      const { error } = await supabase
        .from('emails')
        .upsert(
          {
            ms_message_id: email.id,
            subject: email.subject ?? null,
            sender: sender?.name ?? null,
            sender_email: sender?.address ?? null,
            recipients,
            body_text: email.body?.content ?? null,
            body_preview: email.bodyPreview ?? null,
            received_at: email.receivedDateTime,
            conversation_id: email.conversationId ?? null,
            is_read: email.isRead ?? false,
            folder: 'inbox',
            is_processed: junk,
            review_status: junk ? 'dismissed' : 'pending',
            ...(junk ? { ai_extraction: { is_noise: true, email_category: 'auto_filtered', email_summary: 'Auto-filtered as junk/automated' } } : {}),
          },
          { onConflict: 'ms_message_id', ignoreDuplicates: true }
        );

      if (error) {
        alreadyExists++;
      } else {
        synced++;
      }
    }

    // Process sent
    for (const email of sentEmails) {
      const sender = email.from?.emailAddress as { name?: string; address?: string } | undefined;
      const recipients = [
        ...(email.toRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
          type: 'to',
        })),
        ...(email.ccRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
          name: r.emailAddress?.name,
          address: r.emailAddress?.address,
          type: 'cc',
        })),
      ];

      const { error } = await supabase
        .from('emails')
        .upsert(
          {
            ms_message_id: email.id,
            subject: email.subject ?? null,
            sender: sender?.name ?? null,
            sender_email: sender?.address ?? null,
            recipients,
            body_text: email.body?.content ?? null,
            body_preview: email.bodyPreview ?? null,
            received_at: email.receivedDateTime,
            sent_at: email.sentDateTime ?? email.receivedDateTime,
            conversation_id: email.conversationId ?? null,
            folder: 'sent',
            is_processed: false,
            review_status: 'accepted',
          },
          { onConflict: 'ms_message_id', ignoreDuplicates: true }
        );

      if (error) {
        alreadyExists++;
      } else {
        synced++;
      }
    }

    // Count how many unprocessed emails now need AI extraction
    const { count: unprocessedCount } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('is_processed', false);

    return NextResponse.json({
      success: true,
      lookback_days: days,
      inbox_fetched: inboxEmails.length,
      sent_fetched: sentEmails.length,
      synced,
      junk_auto_filtered: junkSkipped,
      already_existed: alreadyExists,
      unprocessed_awaiting_ai: unprocessedCount || 0,
      note: `The regular sync-email cron will process these in batches of 5 every 5 minutes. At ${unprocessedCount || 0} emails, it will take ~${Math.ceil((unprocessedCount || 0) / 5) * 5} minutes to fully process.`,
    });
  } catch (err) {
    console.error('Email backfill error:', err);
    return NextResponse.json(
      { error: 'Backfill failed', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

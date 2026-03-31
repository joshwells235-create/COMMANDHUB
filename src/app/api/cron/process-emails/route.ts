import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { extractCommitmentsFromEmail } from '@/app/api/ai/extract-email/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Turbo email processing: processes up to 50 unprocessed emails per call.
 * Designed to clear backlogs faster than the regular sync-email cron (15/cycle).
 * Can be added to vercel.json as a cron or called manually.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batchSize = parseInt(url.searchParams.get('batch') || '50', 10);
  const supabase = createServerClient();

  // Fetch unprocessed emails
  const { data: unprocessedEmails, error: fetchError } = await supabase
    .from('emails')
    .select('*')
    .eq('is_processed', false)
    .order('received_at', { ascending: true })
    .limit(Math.min(batchSize, 100));

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }

  let processed = 0;
  const errors: Array<{ email_id: string; error: string }> = [];
  const emails = unprocessedEmails || [];

  // Process in sub-batches of 5 concurrently for ~5x throughput
  for (let i = 0; i < emails.length; i += 5) {
    const batch = emails.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((email) => extractCommitmentsFromEmail(email, supabase))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const email = batch[j];
      if (result.status === 'fulfilled') {
        processed++;
      } else {
        console.error(`Extraction failed for email ${email.id}:`, result.reason);
        errors.push({
          email_id: email.id,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
        await supabase
          .from('emails')
          .update({ is_processed: true, review_status: 'error' })
          .eq('id', email.id);
      }
    }
  }

  // Count remaining
  const { count: remaining } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('is_processed', false);

  return NextResponse.json({
    success: true,
    processed,
    batch_size: (unprocessedEmails || []).length,
    remaining_unprocessed: remaining || 0,
    errors: errors.length > 0 ? errors : undefined,
  });
}

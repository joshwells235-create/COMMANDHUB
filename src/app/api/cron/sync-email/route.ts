import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { syncEmails } from '@/lib/microsoft-graph';
import { extractCommitmentsFromEmail } from '@/app/api/ai/extract-email/route';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const keyParam = url.searchParams.get('key');

    if (authHeader !== `Bearer ${expectedToken}` && keyParam !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Step 1: Sync emails from Microsoft Graph
    const syncCount = await syncEmails();

    // Step 2: Fetch unprocessed emails (batch of 5 to avoid timeout)
    const { data: unprocessedEmails, error: fetchError } = await supabase
      .from('emails')
      .select('*')
      .eq('is_processed', false)
      .order('received_at', { ascending: true })
      .limit(15);

    if (fetchError) {
      console.error('Error fetching unprocessed emails:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch unprocessed emails' },
        { status: 500 }
      );
    }

    // Step 3: Extract intelligence from each unprocessed email
    let extractionCount = 0;
    const errors: Array<{ email_id: string; error: string }> = [];

    for (const email of unprocessedEmails || []) {
      try {
        await extractCommitmentsFromEmail(email, supabase);
        extractionCount++;
      } catch (error) {
        console.error(`Extraction failed for email ${email.id}:`, error);
        errors.push({
          email_id: email.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Mark as processed to avoid retrying broken emails forever
        await supabase
          .from('emails')
          .update({ is_processed: true, review_status: 'error' })
          .eq('id', email.id);
      }
    }

    // Update contact.last_interaction_date for processed emails
    if (extractionCount > 0 && unprocessedEmails) {
      const emailAddresses = new Set<string>();
      for (const email of unprocessedEmails.slice(0, extractionCount)) {
        if (email.sender_email) emailAddresses.add(email.sender_email.toLowerCase());
      }
      if (emailAddresses.size > 0) {
        const { data: matchedContacts } = await supabase
          .from('contacts')
          .select('id, email, last_interaction_date')
          .not('email', 'is', null);

        for (const contact of matchedContacts || []) {
          if (contact.email && emailAddresses.has(contact.email.toLowerCase())) {
            const now = new Date().toISOString();
            if (!contact.last_interaction_date || contact.last_interaction_date < now) {
              await supabase
                .from('contacts')
                .update({ last_interaction_date: now })
                .eq('id', contact.id);
            }
          }
        }
      }
    }

    // Count remaining unprocessed
    const { count: remaining } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('is_processed', false);

    return NextResponse.json({
      success: true,
      sync_count: syncCount,
      extraction_count: extractionCount,
      batch_size: (unprocessedEmails || []).length,
      remaining_unprocessed: remaining || 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Email sync cron error:', error);
    return NextResponse.json(
      { error: 'Sync cron failed' },
      { status: 500 }
    );
  }
}

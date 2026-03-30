import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { syncEmails } from '@/lib/microsoft-graph';
import { extractCommitmentsFromEmail } from '@/app/api/ai/extract-email/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

    // Step 2: Fetch all unprocessed emails
    const { data: unprocessedEmails, error: fetchError } = await supabase
      .from('emails')
      .select('*')
      .eq('is_processed', false)
      .order('received_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching unprocessed emails:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch unprocessed emails' },
        { status: 500 }
      );
    }

    // Step 3: Extract commitments from each unprocessed email inline
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
      }
    }

    return NextResponse.json({
      success: true,
      sync_count: syncCount,
      extraction_count: extractionCount,
      unprocessed_total: (unprocessedEmails || []).length,
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

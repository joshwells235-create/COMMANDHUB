import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/transcripts/reprocess
 * Batch reprocesses transcripts through the AI extraction pipeline.
 * Query params:
 *   - all=true         — reprocess all transcripts that have raw_text
 *   - processed=true   — only reprocess already-processed transcripts
 *   - org_id=<uuid>    — filter to a specific org
 *   - limit=<n>        — max transcripts to process (default 50)
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const all = searchParams.get('all') === 'true';
    const processedOnly = searchParams.get('processed') === 'true';
    const orgId = searchParams.get('org_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

    const supabase = createServerClient();

    // Build query for transcripts to reprocess
    let query = supabase
      .from('transcripts')
      .select('id, title, transcript_date, org_id, is_processed')
      .not('raw_text', 'is', null)
      .order('transcript_date', { ascending: false })
      .limit(limit);

    if (processedOnly) {
      query = query.eq('is_processed', true);
    } else if (!all) {
      // Default: only unprocessed
      query = query.eq('is_processed', false);
    }

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    const { data: transcripts, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!transcripts || transcripts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No transcripts found matching criteria',
        processed: 0,
      });
    }

    // Process each transcript sequentially to avoid rate limits
    const results: Array<{
      id: string;
      title: string | null;
      date: string;
      status: 'success' | 'error';
      error?: string;
      commitments_count?: number;
    }> = [];

    const baseUrl = request.nextUrl.origin;

    for (const transcript of transcripts) {
      try {
        const res = await fetch(`${baseUrl}/api/transcripts/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript_id: transcript.id }),
        });

        const data = await res.json();

        if (res.ok) {
          results.push({
            id: transcript.id,
            title: transcript.title,
            date: transcript.transcript_date,
            status: 'success',
            commitments_count: data.commitments_count,
          });
        } else {
          results.push({
            id: transcript.id,
            title: transcript.title,
            date: transcript.transcript_date,
            status: 'error',
            error: data.error,
          });
        }
      } catch (err) {
        results.push({
          id: transcript.id,
          title: transcript.title,
          date: transcript.transcript_date,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      total: transcripts.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    console.error('Batch reprocess error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch reprocess failed' },
      { status: 500 }
    );
  }
}

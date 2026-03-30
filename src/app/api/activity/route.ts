import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '15');
    const commitmentId = request.nextUrl.searchParams.get('commitment_id');

    // Fetch recent commitment activity
    let activityQuery = supabase
      .from('commitment_activity')
      .select('id, commitment_id, action, details, created_at, commitment:commitments(title, org_id, organization:organizations(name))')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (commitmentId) {
      activityQuery = activityQuery.eq('commitment_id', commitmentId);
    }

    const { data: activities } = await activityQuery;

    // If filtering by commitment_id, return just the activity entries
    if (commitmentId) {
      const result = (activities || []).map((a) => ({
        id: a.id,
        commitment_id: a.commitment_id,
        action: a.action,
        details: a.details,
        created_at: a.created_at,
      }));
      return NextResponse.json(result);
    }

    // Fetch recent transcripts
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('id, title, org_id, is_processed, created_at, organizations(name)')
      .order('created_at', { ascending: false })
      .limit(5);

    // Combine into unified feed
    const feed: Array<{
      id: string;
      type: string;
      action: string;
      title: string;
      org_name: string | null;
      timestamp: string;
      detail?: string;
    }> = [];

    // Map commitment activities
    if (activities) {
      for (const a of activities) {
        const commitment = a.commitment as { title?: string; org_id?: string; organization?: { name: string } } | null;
        feed.push({
          id: `ca-${a.id}`,
          type: 'commitment',
          action: a.action,
          title: commitment?.title || 'Unknown commitment',
          org_name: commitment?.organization?.name || null,
          timestamp: a.created_at,
          detail: a.action === 'snoozed' ? `until ${(a.details as Record<string, string>)?.snoozed_until?.split('T')[0] || ''}` : undefined,
        });
      }
    }

    // Map transcripts
    if (transcripts) {
      for (const t of transcripts) {
        const org = t.organizations as unknown as { name: string } | null;
        feed.push({
          id: `tr-${t.id}`,
          type: 'transcript',
          action: t.is_processed ? 'processed' : 'uploaded',
          title: t.title,
          org_name: org?.name || null,
          timestamp: t.created_at,
        });
      }
    }

    // Sort by timestamp descending
    feed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json(feed.slice(0, limit));
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

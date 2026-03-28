import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('org_id');

    const supabase = createServerClient();

    let query = supabase
      .from('transcripts')
      .select('id, title, org_id, engagement_id, transcript_date, transcript_type, duration_minutes, participants, summary, review_status, created_at, organizations(id, name, status, strategic_value)')
      .order('transcript_date', { ascending: false });

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching transcripts:', error);
      return NextResponse.json({ error: 'Failed to fetch transcripts' }, { status: 500 });
    }

    return NextResponse.json({ transcripts: data });
  } catch (error) {
    console.error('Transcripts list error:', error);
    return NextResponse.json({ error: 'Failed to fetch transcripts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      org_id,
      engagement_id,
      engagement_name,
      transcript_date,
      transcript_type,
      duration_minutes,
      participants,
      raw_text,
    } = body;

    if (!title || !raw_text) {
      return NextResponse.json(
        { error: 'title and raw_text are required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Resolve engagement_id: use explicit ID, or look up/create by name
    let resolvedEngagementId = engagement_id || null;
    if (!resolvedEngagementId && engagement_name && org_id) {
      // Try to find existing engagement by name for this org
      const { data: existing } = await supabase
        .from('engagements')
        .select('id')
        .eq('org_id', org_id)
        .ilike('name', engagement_name)
        .limit(1)
        .single();

      if (existing) {
        resolvedEngagementId = existing.id;
      } else {
        // Create new engagement
        const { data: created } = await supabase
          .from('engagements')
          .insert({ name: engagement_name, org_id, status: 'active' })
          .select('id')
          .single();
        if (created) resolvedEngagementId = created.id;
      }
    }

    const { data, error } = await supabase
      .from('transcripts')
      .insert({
        title,
        org_id: org_id || null,
        engagement_id: resolvedEngagementId,
        transcript_date: transcript_date || null,
        transcript_type: transcript_type || null,
        duration_minutes: duration_minutes || null,
        participants: participants || null,
        raw_text,
        review_status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating transcript:', error);
      return NextResponse.json({ error: error.message || 'Failed to create transcript' }, { status: 500 });
    }

    return NextResponse.json({ transcript: data }, { status: 201 });
  } catch (error) {
    console.error('Transcript creation error:', error);
    return NextResponse.json({ error: 'Failed to create transcript' }, { status: 500 });
  }
}

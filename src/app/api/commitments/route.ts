import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CommitmentCreateInput } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get('status') || 'pending,in_progress';
    const orgId = searchParams.get('org_id');
    const owner = searchParams.get('owner');
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const statusList = status.split(',').map((s) => s.trim());

    let query = supabase
      .from('commitments')
      .select('*, organization:organizations(id, name)')
      .in('status', statusList)
      .order('priority_score', { ascending: false })
      .limit(limit);

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    if (owner) {
      query = query.eq('owner', owner);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const search = searchParams.get('search');
    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body: CommitmentCreateInput = await request.json();

    if (!body.title || !body.commitment_type) {
      return NextResponse.json(
        { error: 'title and commitment_type are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data: commitment, error } = await supabase
      .from('commitments')
      .insert({
        title: body.title,
        description: body.description ?? null,
        commitment_type: body.commitment_type,
        category: body.category ?? 'client',
        org_id: body.org_id ?? null,
        contact_id: body.contact_id ?? null,
        engagement_id: body.engagement_id ?? null,
        other_party: body.other_party ?? null,
        owner: body.owner ?? 'josh',
        due_date: body.due_date ?? null,
        source_type: body.source_type ?? null,
        source_ref: body.source_ref ?? null,
        source_snippet: body.source_snippet ?? null,
        tags: body.tags ?? null,
        status: 'pending',
        priority_score: 0,
        escalation_level: 0,
        ai_priority_modifier: 0,
        last_touched_at: now,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await supabase.from('commitment_activity').insert({
      commitment_id: commitment.id,
      action: 'created',
      details: { title: commitment.title },
    });

    return NextResponse.json(commitment, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

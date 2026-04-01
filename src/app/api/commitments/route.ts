import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CommitmentCreateInput } from '@/types/database';
import { dedupAndCreateCommitment } from '@/lib/create-commitment';

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

    const result = await dedupAndCreateCommitment(supabase, {
      title: body.title,
      description: body.description,
      commitment_type: body.commitment_type,
      category: body.category,
      org_id: body.org_id,
      contact_id: body.contact_id,
      engagement_id: body.engagement_id,
      other_party: body.other_party,
      owner: body.owner,
      due_date: body.due_date,
      source_type: body.source_type,
      source_ref: body.source_ref,
      source_snippet: body.source_snippet,
      tags: body.tags,
    });

    if (!result.created) {
      return NextResponse.json(
        { duplicate: true, existing_title: result.duplicate_of, message: `Similar commitment already exists: "${result.duplicate_of}"` },
        { status: 200 }
      );
    }

    // Fetch the full commitment to return
    const { data: commitment } = await supabase
      .from('commitments')
      .select('*')
      .eq('id', result.id)
      .single();

    return NextResponse.json(commitment, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

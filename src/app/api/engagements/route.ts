import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const orgId = url.searchParams.get('org_id');
    const status = url.searchParams.get('status');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    let query = supabase
      .from('engagements')
      .select('*, organizations(name)')
      .order('start_date', { ascending: false })
      .limit(limit);

    if (orgId) query = query.eq('org_id', orgId);
    if (status) query = query.in('status', status.split(','));

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch engagements' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { org_id, org_name, name, type, status, value_amount, start_date, end_date, notes } = body;

    // Resolve org_id from org_name if needed
    let resolvedOrgId = org_id;
    if (!resolvedOrgId && org_name) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id')
        .ilike('name', `%${org_name}%`)
        .limit(1)
        .single();
      resolvedOrgId = org?.id;
    }

    const { data, error } = await supabase
      .from('engagements')
      .insert({
        org_id: resolvedOrgId || null,
        name: name || 'Untitled Engagement',
        type: type || null,
        status: status || 'active',
        value_amount: value_amount || null,
        start_date: start_date || null,
        end_date: end_date || null,
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create engagement' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = request.nextUrl;
    const orgId = searchParams.get('org_id');

    let query = supabase
      .from('contacts')
      .select('*')
      .order('name', { ascending: true });

    if (orgId) {
      query = query.eq('org_id', orgId);
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

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = request.nextUrl;
    const orgId = searchParams.get('org_id');
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let query = supabase
      .from('contacts')
      .select('*')
      .order('name', { ascending: true });

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Attach org names
    let results: Record<string, unknown>[] = data || [];
    const orgIds = [...new Set(results.map((c) => c.org_id).filter(Boolean))];
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);
      const orgMap = new Map((orgs || []).map((o: { id: string; name: string }) => [o.id, o]));
      results = results.map((c) => ({
        ...c,
        organizations: c.org_id ? orgMap.get(c.org_id as string) || null : null,
      }));
    }
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((c) => {
        const s = (v: unknown) => typeof v === 'string' ? v.toLowerCase() : '';
        return s(c.name).includes(q) || s(c.role).includes(q) || s(c.title).includes(q) || s(c.company).includes(q) || s(c.email).includes(q);
      });
    }

    return NextResponse.json(results);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const record: Record<string, unknown> = {
      name: body.name.trim(),
      org_id: body.org_id || null,
      role: body.role || null,
      email: body.email || null,
      phone: body.phone || null,
      linkedin_url: body.linkedin_url || null,
      title: body.title || null,
      company: body.company || null,
      category: body.category || 'business',
      relationship_type: body.relationship_type && body.relationship_type.length > 0 ? body.relationship_type : [],
      personality_notes: body.personality_notes || null,
      coaching_focus: body.coaching_focus || null,
      communication_style: body.communication_style || null,
      notes: body.notes || null,
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert(record)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

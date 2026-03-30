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
      .select('*, organizations(id, name)')
      .order('name', { ascending: true });

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Client-side search filter (name, role, title, company, email)
    let results = data || [];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.role?.toLowerCase().includes(q) ||
          c.title?.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q)
      );
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
      relationship_type: body.relationship_type || null,
      personality_notes: body.personality_notes || null,
      coaching_focus: body.coaching_focus || null,
      communication_style: body.communication_style || null,
      notes: body.notes || null,
    };

    const { data, error } = await supabase
      .from('contacts')
      .insert(record)
      .select('*, organizations(id, name)')
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

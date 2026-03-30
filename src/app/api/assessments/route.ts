import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = request.nextUrl;
    const contactId = searchParams.get('contact_id');
    const orgId = searchParams.get('org_id');
    const type = searchParams.get('type');

    let query = supabase
      .from('assessments')
      .select('*, contacts(id, name), organizations(id, name)')
      .order('assessment_date', { ascending: false });

    if (contactId) query = query.eq('contact_id', contactId);
    if (orgId) query = query.eq('org_id', orgId);
    if (type) query = query.eq('assessment_type', type);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    if (!body.contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }
    if (!body.assessment_type) {
      return NextResponse.json({ error: 'assessment_type is required' }, { status: 400 });
    }

    const record: Record<string, unknown> = {
      contact_id: body.contact_id,
      org_id: body.org_id || null,
      assessment_type: body.assessment_type,
      title: body.title || `${body.assessment_type.replace(/_/g, ' ')} Assessment`,
      assessment_date: body.assessment_date || null,
      raw_text: body.raw_text || null,
      file_url: body.file_url || null,
      file_name: body.file_name || null,
      file_type: body.file_type || null,
      summary: body.summary || null,
      key_findings: body.key_findings || null,
      ai_analysis: body.ai_analysis || null,
      notes: body.notes || null,
    };

    const { data, error } = await supabase
      .from('assessments')
      .insert(record)
      .select('*, contacts(id, name)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerClient();
    const { id } = await params;
    const body = await request.json();

    if (!body.snoozed_until) {
      return NextResponse.json(
        { error: 'snoozed_until is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('commitments')
      .update({
        status: 'snoozed',
        snoozed_until: body.snoozed_until,
        last_touched_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Commitment not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await supabase.from('commitment_activity').insert({
      commitment_id: id,
      action: 'snoozed',
      details: { snoozed_until: body.snoozed_until },
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

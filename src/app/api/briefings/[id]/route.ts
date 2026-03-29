import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('briefings')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Briefing not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch briefing' }, { status: 500 });
  }
}

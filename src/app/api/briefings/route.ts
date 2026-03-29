import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'morning' | 'weekly' | null (all)
    const limit = parseInt(searchParams.get('limit') || '10');

    let query = supabase
      .from('briefings')
      .select('id, briefing_type, summary, generated_at')
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq('briefing_type', type);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch briefings' }, { status: 500 });
  }
}

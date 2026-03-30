import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { startOfDay, endOfDay, format } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();

    // Check if Microsoft auth tokens exist
    const { data: tokens } = await supabase
      .from('auth_tokens')
      .select('id')
      .eq('provider', 'microsoft')
      .limit(1)
      .single();

    if (!tokens) {
      return NextResponse.json({ error: 'Not connected' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');
    const date = new Date(dateStr);
    const dayStart = startOfDay(date).toISOString();
    const dayEnd = endOfDay(date).toISOString();

    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .order('start_time', { ascending: true });

    if (error) throw error;

    return NextResponse.json(events || []);
  } catch (error) {
    console.error('Calendar fetch error:', error);
    return NextResponse.json([], { status: 200 });
  }
}

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
    const days = parseInt(searchParams.get('days') || '1', 10);
    const orgId = searchParams.get('org_id');
    const date = new Date(dateStr);
    const dayStart = startOfDay(date).toISOString();
    const rangeEnd = endOfDay(new Date(date.getTime() + (days - 1) * 86400000)).toISOString();

    const excludePersonal = searchParams.get('include_personal') !== 'true';

    let query = supabase
      .from('calendar_events')
      .select('*')
      .gte('start_time', dayStart)
      .lte('start_time', rangeEnd)
      .order('start_time', { ascending: true });

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    const { data: events, error } = await query;

    // Filter out personal events (Sleep, Deep Work, etc.) unless explicitly requested
    const filtered = excludePersonal
      ? (events || []).filter((e) => {
          const eventType = (e.ai_analysis as Record<string, unknown> | null)?.event_type;
          return eventType !== 'personal';
        })
      : events || [];

    if (error) throw error;

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('Calendar fetch error:', error);
    return NextResponse.json([], { status: 200 });
  }
}

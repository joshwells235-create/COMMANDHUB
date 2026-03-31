import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const { log_type, title, description, tags, metadata, logged_at } = body;

    if (!log_type || !title) {
      return NextResponse.json({ error: 'log_type and title are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('life_logs')
      .insert({
        log_type,
        title,
        description: description || null,
        tags: tags || [],
        metadata: metadata || null,
        logged_at: logged_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Life log error:', error);
    return NextResponse.json({ error: 'Failed to create life log' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);
    const tag = searchParams.get('tag');

    const since = new Date();
    since.setDate(since.getDate() - days);

    let query = supabase
      .from('life_logs')
      .select('*')
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false });

    if (tag) {
      query = query.contains('tags', [tag]);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('Life log fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch life logs' }, { status: 500 });
  }
}

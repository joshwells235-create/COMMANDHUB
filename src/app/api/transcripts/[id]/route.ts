import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Transcript ID required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('transcripts')
      .select('*, organizations(id, name, status, strategic_value, industry), engagements(id, name, type, status)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
    }

    return NextResponse.json({ transcript: data });
  } catch (error) {
    console.error('Transcript fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const supabase = createServerClient();

    // Support two modes:
    // 1. find_replace: { find: string, replace: string } — replaces all occurrences in raw_text
    // 2. Direct field updates: { title, raw_text, transcript_date, participants, etc. }

    if (body.find_replace) {
      const { find, replace } = body.find_replace;
      if (!find) {
        return NextResponse.json({ error: 'find string is required' }, { status: 400 });
      }

      // Fetch current raw_text
      const { data: current, error: fetchErr } = await supabase
        .from('transcripts')
        .select('raw_text')
        .eq('id', id)
        .single();

      if (fetchErr || !current) {
        return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
      }

      const updatedText = current.raw_text.split(find).join(replace);
      const replacementCount = (current.raw_text.split(find).length - 1);

      const { data, error } = await supabase
        .from('transcripts')
        .update({ raw_text: updatedText })
        .eq('id', id)
        .select('id, raw_text')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Also update transcript_chunks that contain the misspelling
      const { data: chunks } = await supabase
        .from('transcript_chunks')
        .select('id, content')
        .eq('transcript_id', id)
        .ilike('content', `%${find}%`);

      if (chunks && chunks.length > 0) {
        for (const chunk of chunks) {
          await supabase
            .from('transcript_chunks')
            .update({ content: chunk.content.split(find).join(replace) })
            .eq('id', chunk.id);
        }
      }

      return NextResponse.json({
        transcript: data,
        replacements: replacementCount,
        chunks_updated: chunks?.length || 0,
      });
    }

    // Direct field updates
    const ALLOWED = ['title', 'raw_text', 'transcript_date', 'transcript_type', 'participants', 'duration_minutes', 'category'];
    const updates: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('transcripts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ transcript: data });
  } catch (error) {
    console.error('Transcript update error:', error);
    return NextResponse.json({ error: 'Failed to update transcript' }, { status: 500 });
  }
}

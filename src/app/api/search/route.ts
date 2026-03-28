import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const orgId = searchParams.get('org_id');
    const type = searchParams.get('type');

    if (!query) {
      return NextResponse.json({ error: 'q parameter required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Use PostgreSQL full-text search via pg_trgm + text matching
    const { data: chunks, error: searchError } = await supabase
      .rpc('search_transcript_chunks_text', {
        search_query: query,
        match_count: 10,
        filter_org_id: orgId || null,
      });

    if (searchError) {
      console.error('Search RPC error:', searchError);
      // Fallback: simple ILIKE search if RPC doesn't exist yet
      let fallbackQuery = supabase
        .from('transcript_chunks')
        .select('id, content, metadata, transcript_id, org_id')
        .ilike('content', `%${query}%`)
        .limit(10);

      if (orgId) {
        fallbackQuery = fallbackQuery.eq('org_id', orgId);
      }

      const { data: fallbackChunks } = await fallbackQuery;

      if (!fallbackChunks || fallbackChunks.length === 0) {
        return NextResponse.json({
          answer: 'No relevant transcript content found for your query.',
          sources: [],
        });
      }

      // Get transcript details for fallback chunks
      const transcriptIds = [...new Set(fallbackChunks.map((c) => c.transcript_id))];
      const { data: transcripts } = await supabase
        .from('transcripts')
        .select('id, title, transcript_date, transcript_type, organizations(name)')
        .in('id', transcriptIds);

      const transcriptMap = new Map(
        (transcripts || []).map((t) => [t.id, t])
      );

      const enrichedChunks = fallbackChunks.map((c) => {
        const t = transcriptMap.get(c.transcript_id);
        const orgArr = t?.organizations as unknown as { name: string }[] | null;
        return {
          ...c,
          transcript_title: t?.title || 'Unknown',
          transcript_date: t?.transcript_date || 'Unknown',
          transcript_type: t?.transcript_type || 'Unknown',
          org_name: orgArr?.[0]?.name || (c.metadata as { org_name?: string })?.org_name || 'Unknown',
        };
      });

      return await synthesizeAnswer(query, enrichedChunks);
    }

    // Filter by transcript type if provided
    let filteredChunks = chunks || [];
    if (type) {
      filteredChunks = filteredChunks.filter(
        (c: { transcript_type: string | null }) => c.transcript_type === type
      );
    }

    if (filteredChunks.length === 0) {
      return NextResponse.json({
        answer: 'No relevant transcript content found for your query. Try broadening your search or checking if transcripts have been processed.',
        sources: [],
      });
    }

    return await synthesizeAnswer(query, filteredChunks);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function synthesizeAnswer(
  query: string,
  chunks: Array<{
    id?: string;
    content: string;
    transcript_title: string;
    transcript_date: string;
    org_name: string;
    transcript_type: string;
    transcript_id?: string;
    similarity?: number;
  }>
) {
  const contextBlocks = chunks.map(
    (chunk, i) =>
      `[${i + 1}] From "${chunk.transcript_title}" (${chunk.org_name}, ${chunk.transcript_date}, ${chunk.transcript_type}):\n${chunk.content}`
  );

  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are Command Hub, Josh Wells's AI chief of staff. You have access to
Josh's consulting transcript history. Answer his question using the
retrieved context below.

Question: ${query}

Retrieved context (from transcripts, most relevant first):
${contextBlocks.join('\n\n')}

Rules:
- Answer directly and specifically
- Cite which session/date/client the information comes from
- If the context does not contain enough to answer, say so clearly
- If the question is about patterns across sessions, synthesize rather than listing each mention`,
      },
    ],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  const answer = textContent && textContent.type === 'text' ? textContent.text : 'Unable to generate answer.';

  const sources = chunks.map((chunk) => ({
    chunk_id: chunk.id,
    transcript_id: chunk.transcript_id,
    transcript_title: chunk.transcript_title,
    transcript_date: chunk.transcript_date,
    transcript_type: chunk.transcript_type,
    org_name: chunk.org_name,
    snippet: chunk.content.substring(0, 200) + '...',
  }));

  return NextResponse.json({ answer, sources });
}

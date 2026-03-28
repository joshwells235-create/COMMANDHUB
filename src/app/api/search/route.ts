import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/embeddings';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

/*
-- Add this function to Supabase (also appended to supabase/schema.sql)
CREATE OR REPLACE FUNCTION search_transcript_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter_org_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  transcript_id uuid,
  transcript_title text,
  transcript_date date,
  transcript_type text,
  org_name text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tc.id,
    tc.content,
    tc.metadata,
    1 - (tc.embedding <=> query_embedding) as similarity,
    t.id as transcript_id,
    t.title as transcript_title,
    t.transcript_date,
    t.transcript_type,
    o.name as org_name
  FROM transcript_chunks tc
  JOIN transcripts t ON tc.transcript_id = t.id
  LEFT JOIN organizations o ON tc.org_id = o.id
  WHERE (filter_org_id IS NULL OR tc.org_id = filter_org_id)
    AND 1 - (tc.embedding <=> query_embedding) > match_threshold
  ORDER BY tc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
*/

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

    // 1. Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // 2. Search transcript chunks via Supabase RPC
    const rpcParams: {
      query_embedding: string;
      match_threshold: number;
      match_count: number;
      filter_org_id?: string;
    } = {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.5,
      match_count: 10,
    };

    if (orgId) {
      rpcParams.filter_org_id = orgId;
    }

    const { data: chunks, error: searchError } = await supabase
      .rpc('search_transcript_chunks', rpcParams);

    if (searchError) {
      console.error('Search RPC error:', searchError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
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

    // 3. Build context and pass to Claude for synthesis
    const contextBlocks = filteredChunks.map(
      (chunk: {
        content: string;
        transcript_title: string;
        transcript_date: string;
        org_name: string;
        similarity: number;
        transcript_type: string;
      }, i: number) =>
        `[${i + 1}] From "${chunk.transcript_title}" (${chunk.org_name}, ${chunk.transcript_date}, ${chunk.transcript_type}) [similarity: ${chunk.similarity.toFixed(3)}]:\n${chunk.content}`
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
    const answer = textContent && textContent.type === 'text'
      ? textContent.text
      : 'Unable to generate answer.';

    // 4. Return answer with sources
    const sources = filteredChunks.map(
      (chunk: {
        id: string;
        transcript_id: string;
        transcript_title: string;
        transcript_date: string;
        transcript_type: string;
        org_name: string;
        similarity: number;
        content: string;
      }) => ({
        chunk_id: chunk.id,
        transcript_id: chunk.transcript_id,
        transcript_title: chunk.transcript_title,
        transcript_date: chunk.transcript_date,
        transcript_type: chunk.transcript_type,
        org_name: chunk.org_name,
        similarity: chunk.similarity,
        snippet: chunk.content.substring(0, 200) + '...',
      })
    );

    return NextResponse.json({ answer, sources });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}

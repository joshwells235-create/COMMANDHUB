import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/embeddings';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function needsRAG(message: string): boolean {
  const ragKeywords = ['session', 'said', 'discussed', 'theme', 'transcript', 'mentioned', 'talked about', 'conversation', 'coaching'];
  const lower = message.toLowerCase();
  return ragKeywords.some((kw) => lower.includes(kw));
}

function detectIntent(message: string): {
  fetchClients: boolean;
  fetchCalendar: boolean;
  fetchCommitments: boolean;
  isDraft: boolean;
  clientName: string | null;
} {
  const lower = message.toLowerCase();

  const isDraft = lower.includes('draft') || lower.includes('write');
  const fetchCalendar =
    lower.includes('schedule') ||
    lower.includes('calendar') ||
    lower.includes('week') ||
    lower.includes('today') ||
    lower.includes('upcoming');
  const fetchClients =
    lower.includes('client') ||
    lower.includes('org') ||
    lower.includes('company');
  const fetchCommitments =
    lower.includes('overdue') ||
    lower.includes('priorities') ||
    lower.includes('priority') ||
    lower.includes("what's next") ||
    lower.includes('what should') ||
    lower.includes('forgetting') ||
    lower.includes('forget') ||
    lower.includes('commitments') ||
    lower.includes('to do') ||
    lower.includes('todo');

  // Try to extract a client name (simple heuristic: word after "with" or quoted text)
  let clientName: string | null = null;
  const withMatch = lower.match(/(?:with|for|about)\s+([a-z][\w\s]*?)(?:\?|$|\.|\s+(?:and|or|but))/);
  if (withMatch) {
    clientName = withMatch[1].trim();
  }

  return { fetchClients, fetchCalendar, fetchCommitments, isDraft, clientName };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [] } = body as {
      message: string;
      history?: ChatMessage[];
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const intent = detectIntent(message);

    // Collect context pieces
    const contextParts: string[] = [];

    // Always fetch top commitments for general context
    const { data: commitments } = await supabase
      .from('commitments')
      .select('title, commitment_type, owner, due_date, status, escalation_level, organizations(name)')
      .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
      .order('priority_score', { ascending: false })
      .limit(20);

    if (commitments && commitments.length > 0) {
      const overdueItems = commitments.filter(
        (c) => c.due_date && new Date(c.due_date) < new Date() && c.status !== 'waiting'
      );
      const dueToday = commitments.filter((c) => {
        if (!c.due_date) return false;
        const d = new Date(c.due_date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      });

      contextParts.push(`COMMITMENTS (${commitments.length} open):
Top priorities:
${commitments
  .slice(0, 10)
  .map(
    (c) => {
      const orgArr = c.organizations as unknown as { name: string }[] | null;
      const orgName = orgArr?.[0]?.name;
      return `- [${c.owner === 'josh' ? 'Josh' : 'Other'}] ${c.title} (${c.commitment_type}${c.due_date ? ', due ' + c.due_date : ''}${orgName ? ', ' + orgName : ''})`;
    }
  )
  .join('\n')}
${overdueItems.length > 0 ? `\nOVERDUE (${overdueItems.length}): ${overdueItems.map((c) => c.title).join(', ')}` : ''}
${dueToday.length > 0 ? `\nDUE TODAY (${dueToday.length}): ${dueToday.map((c) => c.title).join(', ')}` : ''}`);
    }

    // Fetch calendar events if relevant or as default context
    if (intent.fetchCalendar || !intent.fetchCommitments) {
      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const { data: events } = await supabase
        .from('calendar_events')
        .select('subject, start_time, end_time, location, organizations(name)')
        .gte('start_time', now.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time', { ascending: true })
        .limit(15);

      if (events && events.length > 0) {
        contextParts.push(`UPCOMING CALENDAR (next 7 days):
${events
  .map((e) => {
    const orgArr = e.organizations as unknown as { name: string }[] | null;
    const orgName = orgArr?.[0]?.name;
    const start = new Date(e.start_time);
    return `- ${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.subject || 'Untitled'}${orgName ? ' (' + orgName + ')' : ''}${e.location ? ' @ ' + e.location : ''}`;
  })
  .join('\n')}`);
      }
    }

    // Fetch client info if relevant
    if (intent.fetchClients || intent.clientName) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('name, status, strategic_value, industry')
        .eq('status', 'active');

      if (orgs && orgs.length > 0) {
        contextParts.push(`ACTIVE CLIENTS:
${orgs.map((o) => `- ${o.name} (${o.strategic_value}, ${o.industry || 'no industry'})`).join('\n')}`);
      }
    }

    // Draft redirect
    if (intent.isDraft) {
      contextParts.push(
        `DRAFTING: Josh can use the Draft Communication feature on any client page at /clients/[id]. Suggest he navigate there or tell him what to draft and for which client.`
      );
    }

    // RAG search for transcript-related queries
    let ragContext = '';
    if (needsRAG(message)) {
      try {
        const queryEmbedding = await generateEmbedding(message);
        const { data: chunks } = await supabase.rpc('search_transcript_chunks', {
          query_embedding: JSON.stringify(queryEmbedding),
          match_threshold: 0.5,
          match_count: 5,
        });

        if (chunks && chunks.length > 0) {
          ragContext = `\nTRANSCRIPT CONTEXT (from RAG search):
${chunks
  .map(
    (c: { content: string; transcript_title: string; transcript_date: string; org_name: string }) =>
      `[${c.transcript_title}, ${c.transcript_date}, ${c.org_name}]: ${c.content.substring(0, 300)}`
  )
  .join('\n\n')}`;
        }
      } catch (err) {
        console.error('RAG search failed (non-fatal):', err);
      }
    }

    // Build system prompt
    const systemPrompt = `You are Command Hub, Josh Wells's AI chief of staff at LeadShift.
You have access to Josh's commitments, calendar, client data, and transcript history. Answer conversationally but concisely.

Current data context:
${contextParts.join('\n\n')}
${ragContext}

Rules:
- Be direct and actionable
- If Josh asks "what should I do", give the #1 priority with reasoning
- Cite specific data (dates, client names, commitment titles)
- If you don't have enough data, say so honestly
- Keep responses under 200 words unless Josh asks for detail`;

    // Build messages for Claude
    const claudeMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of history) {
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
    claudeMessages.push({ role: 'user', content: message });

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const textContent = response.content.find((c) => c.type === 'text');
    const reply = textContent && textContent.type === 'text' ? textContent.text : 'I was unable to generate a response.';

    return NextResponse.json({ response: reply });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 }
    );
  }
}

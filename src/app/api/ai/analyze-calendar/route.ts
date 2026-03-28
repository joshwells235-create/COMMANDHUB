import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { event_id } = await request.json();
    if (!event_id) {
      return NextResponse.json({ error: 'event_id required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch the event
    const { data: event, error: eventError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Fetch orgs and contacts for matching
    const { data: orgs } = await supabase
      .from('organizations')
      .select('name, id, strategic_value')
      .eq('status', 'active');

    const { data: contacts } = await supabase
      .from('contacts')
      .select('name, id, org_id, role, relationship_type');

    const orgList = (orgs || []).map((o) => o.name).join(', ');
    const contactList = (contacts || [])
      .map((c) => {
        const org = orgs?.find((o) => o.id === c.org_id);
        return `${c.name}${org ? ` (${org.name})` : ''}${c.role ? ` - ${c.role}` : ''}`;
      })
      .join('\n');

    const attendees = event.attendees
      ? (event.attendees as Array<{ emailAddress?: { name?: string; address?: string } }>)
          .map((a) => `${a.emailAddress?.name || ''} <${a.emailAddress?.address || ''}>`)
          .join(', ')
      : 'None listed';

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are an executive assistant for Josh Wells, a leadership development consultant and Partner at LeadShift. You are analyzing a calendar event to help Josh prepare.

Known organizations Josh works with: ${orgList}
Known contacts:
${contactList}

Calendar Event:
  Subject: ${event.subject || 'No subject'}
  Time: ${event.start_time} - ${event.end_time}
  Location: ${event.location || 'Not specified'}
  Attendees: ${attendees}
  Body/Notes: ${event.body_preview || 'None'}

Determine:
1. Which organization does this event relate to? Match against the known list. If no match, set to null.
2. What type of event is this? Options: coaching_session, workshop, pi_session, client_meeting, internal_leadshift, vistage, personal, other
3. What should Josh prepare or review before this event? Be specific and concise.
4. Are there any implied commitments? List as potential items with suggested due dates.

Return JSON only:
{
  "org_match": "org_name or null",
  "org_match_confidence": "high|medium|low",
  "event_type": "...",
  "prep_notes": "What Josh should prepare",
  "implied_commitments": [
    {
      "title": "...",
      "description": "...",
      "commitment_type": "prep|follow_up|deliverable",
      "suggested_due": "ISO datetime or null",
      "timing": "before|after"
    }
  ]
}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No AI response' }, { status: 500 });
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const analysis = JSON.parse(jsonStr);

    // Match org name to ID
    let matchedOrgId: string | null = null;
    if (analysis.org_match) {
      const matchedOrg = orgs?.find(
        (o) => o.name.toLowerCase() === analysis.org_match.toLowerCase()
      );
      if (matchedOrg) matchedOrgId = matchedOrg.id;
    }

    // Update the event with analysis
    await supabase
      .from('calendar_events')
      .update({
        ai_analysis: analysis,
        org_id: matchedOrgId,
        is_processed: true,
      })
      .eq('id', event_id);

    // Auto-create prep commitments for before-event items
    if (analysis.implied_commitments?.length > 0) {
      for (const commitment of analysis.implied_commitments) {
        if (commitment.timing === 'before') {
          const prepDue = commitment.suggested_due
            || new Date(new Date(event.start_time).getTime() - 24 * 60 * 60 * 1000).toISOString();

          await supabase.from('commitments').insert({
            title: commitment.title,
            description: commitment.description,
            commitment_type: commitment.commitment_type || 'prep',
            org_id: matchedOrgId,
            due_date: prepDue,
            source_type: 'calendar',
            source_ref: event_id,
            owner: 'josh',
          });
        }
      }
    }

    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    console.error('AI calendar analysis error:', error);
    return NextResponse.json(
      { error: 'Analysis failed' },
      { status: 500 }
    );
  }
}

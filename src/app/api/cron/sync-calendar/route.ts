import { NextResponse } from 'next/server';
import { syncCalendar } from '@/lib/microsoft-graph';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await syncCalendar();

    const supabase = createServerClient();

    // Auto-analyze unprocessed calendar events (batch of 3 to avoid timeout)
    const { data: unprocessed } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('is_processed', false)
      .order('start_time', { ascending: true })
      .limit(3);

    let analyzed = 0;
    if (unprocessed && unprocessed.length > 0) {
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

      const client = new Anthropic();

      for (const event of unprocessed) {
        try {
          const attendees = event.attendees
            ? (event.attendees as Array<{ emailAddress?: { name?: string; address?: string } }>)
                .map((a) => `${a.emailAddress?.name || ''} <${a.emailAddress?.address || ''}>`)
                .join(', ')
            : 'None listed';

          const message = await client.messages.create({
            model: AI_MODEL,
            max_tokens: 1024,
            messages: [
              {
                role: 'user',
                content: `You are an executive assistant for Josh Wells, a leadership development consultant and Partner at LeadShift. Analyze this calendar event.

Known organizations: ${orgList}
Known contacts:
${contactList}

Event:
  Subject: ${event.subject || 'No subject'}
  Time: ${event.start_time} - ${event.end_time}
  Location: ${event.location || 'Not specified'}
  Attendees: ${attendees}
  Body/Notes: ${event.body_preview || 'None'}

Return JSON only:
{
  "org_match": "org_name or null",
  "event_type": "coaching_session|workshop|pi_session|client_meeting|internal_leadshift|vistage|personal|other",
  "importance": "high|medium|low",
  "prep_notes": "What Josh should prepare (be specific)",
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
          if (textContent && textContent.type === 'text') {
            let jsonStr = textContent.text.trim();
            if (jsonStr.startsWith('```')) {
              jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
            }
            const analysis = JSON.parse(jsonStr);

            let matchedOrgId: string | null = null;
            if (analysis.org_match) {
              const matchedOrg = orgs?.find(
                (o) => o.name.toLowerCase() === analysis.org_match.toLowerCase()
              );
              if (matchedOrg) matchedOrgId = matchedOrg.id;
            }

            await supabase
              .from('calendar_events')
              .update({
                ai_analysis: analysis,
                org_id: matchedOrgId,
                is_processed: true,
              })
              .eq('id', event.id);

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
                    source_ref: event.id,
                    owner: 'josh',
                    status: 'pending',
                    priority_score: 50,
                  });
                }
              }
            }

            analyzed++;
          }
        } catch (e) {
          console.error(`Failed to analyze event ${event.id}:`, e);
          // Mark as processed to avoid retrying forever
          await supabase
            .from('calendar_events')
            .update({ is_processed: true })
            .eq('id', event.id);
        }
      }
    }

    // Update contact.last_interaction_date for attendees of recent events
    if (analyzed > 0 && unprocessed) {
      const attendeeEmails = new Set<string>();
      for (const event of unprocessed) {
        if (event.attendees) {
          for (const a of event.attendees as Array<{ emailAddress?: { address?: string } }>) {
            const email = a.emailAddress?.address?.toLowerCase();
            if (email) attendeeEmails.add(email);
          }
        }
      }
      if (attendeeEmails.size > 0) {
        const { data: matchedContacts } = await supabase
          .from('contacts')
          .select('id, email, last_interaction_date')
          .not('email', 'is', null);

        const now = new Date().toISOString();
        for (const contact of matchedContacts || []) {
          if (contact.email && attendeeEmails.has(contact.email.toLowerCase())) {
            if (!contact.last_interaction_date || contact.last_interaction_date < now) {
              await supabase
                .from('contacts')
                .update({ last_interaction_date: now })
                .eq('id', contact.id);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Calendar synced and analyzed',
      analyzed,
      unprocessed_remaining: Math.max(0, (unprocessed?.length || 0) - analyzed),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to sync calendar', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

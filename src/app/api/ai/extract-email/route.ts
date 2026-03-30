import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { email_id } = await request.json();
    if (!email_id) {
      return NextResponse.json({ error: 'email_id required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch the email
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('id', email_id)
      .single();

    if (emailError || !email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const extraction = await extractCommitmentsFromEmail(email, supabase);

    return NextResponse.json({ success: true, extraction });
  } catch (error) {
    console.error('AI email extraction error:', error);
    return NextResponse.json(
      { error: 'Extraction failed' },
      { status: 500 }
    );
  }
}

export async function extractCommitmentsFromEmail(
  email: Record<string, unknown>,
  supabase: ReturnType<typeof createServerClient>
) {
  const isSent = email.folder === 'sent';

  // Fetch orgs, contacts, and pending commitments in parallel
  const [orgRes, contactRes, pendingRes] = await Promise.all([
    supabase.from('organizations').select('name, id, strategic_value, status'),
    supabase.from('contacts').select('name, id, org_id, role, email, relationship_type'),
    isSent
      ? supabase
          .from('commitments')
          .select('id, title, description, commitment_type, owner, other_party, org_id, status')
          .in('status', ['pending', 'in_progress', 'waiting'])
          .order('priority_score', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const orgs = orgRes.data || [];
  const contacts = contactRes.data || [];
  const pendingCommitments = pendingRes.data || [];

  const orgList = orgs.map((o) => `${o.name} (${o.status}, ${o.strategic_value})`).join(', ');
  const contactList = contacts
    .map((c) => {
      const org = orgs.find((o) => o.id === c.org_id);
      return `${c.name}${org ? ` (${org.name})` : ''}${c.role ? ` - ${c.role}` : ''}${c.email ? ` <${c.email}>` : ''}`;
    })
    .join('\n');

  const recipients = Array.isArray(email.recipients)
    ? (email.recipients as Array<{ name?: string; address?: string; type?: string }>)
        .map((r) => `${r.name || ''} <${r.address || ''}> (${r.type || 'to'})`)
        .join(', ')
    : 'Unknown';

  // Build the pending commitments context for sent emails
  const pendingContext = isSent && pendingCommitments.length > 0
    ? `\n\nPENDING COMMITMENTS (check if this sent email resolves any of these):\n${pendingCommitments.map((c) => `- [ID:${c.id}] "${c.title}" (${c.commitment_type}, owner: ${c.owner}${c.other_party ? `, with: ${c.other_party}` : ''})`).join('\n')}`
    : '';

  const directionContext = isSent
    ? `This is a SENT email — Josh wrote this. Analyze what Josh is promising, delivering, or following up on. This tells you what Josh is actively doing.`
    : `This is a RECEIVED email — someone sent this to Josh. Analyze what's being asked, promised, or communicated to Josh.`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are an executive assistant and intelligence analyst for Josh Wells, a Partner at LeadShift, a leadership development consulting firm. You are analyzing an email to extract actionable intelligence — not just commitments, but everything useful for client relationships, session prep, and business development.

${directionContext}

Known organizations Josh works with: ${orgList}
Known contacts:
${contactList}
${pendingContext}

Email Details:
  Subject: ${email.subject || 'No subject'}
  From: ${email.sender || 'Unknown'} <${email.sender_email || ''}>
  To/CC: ${recipients}
  Date: ${email.sent_at || email.received_at || 'Unknown'}
  Body:
${email.body_text || email.body_preview || 'No body'}

STEP 1 — CLASSIFY THIS EMAIL:
Determine the category: client (from/about a client org), internal (LeadShift team), vendor (tools/services), newsletter (marketing/automated), personal, or scheduling.
If it's a newsletter or automated marketing email, set is_noise: true and skip detailed extraction.

STEP 2 — EXTRACT INTELLIGENCE:
For non-noise emails, extract:

COMMITMENTS — any action items, promises, asks, or follow-ups:
${isSent ? `Since Josh SENT this email:
1. PROMISES JOSH MADE - things Josh said he would do ("I'll send that over", "I will follow up") → owner="josh", commitment_type="promise_made"
2. THINGS JOSH DELIVERED - did Josh send a document, answer a question, or complete a task? → owner="josh", commitment_type="deliverable"
3. NEW FOLLOW-UPS CREATED - did Josh's email create new expectations for a response or next step? → owner="josh", commitment_type="follow_up"
4. WAITING_ON ITEMS - is Josh now waiting for someone to respond or act? → owner="other", commitment_type="waiting_on"` : `Since Josh RECEIVED this email:
1. ASKS OF JOSH - direct requests made to Josh → owner="josh", commitment_type="ask_received"
2. PROMISES OTHERS MADE TO JOSH - things the sender said THEY will do ("I'll send that", "We'll take care of it", "I will follow up") → owner="other", commitment_type="waiting_on"
3. IMPLICIT FOLLOW-UPS - proposals need follow-up, questions need responses, meetings need prep → owner="josh", commitment_type="follow_up"
4. INFORMATION FOR JOSH - FYI items that don't need action → skip, do NOT create a commitment`}

CRITICAL RULES:
- When someone OTHER than Josh promises to do something, set owner="other" and commitment_type="waiting_on". Do NOT put these on Josh's plate.
- Do NOT create commitments for attending meetings, joining calls, or showing up to events. The calendar handles scheduling. Only create commitments for actual action items — things to prepare, send, review, or follow up on.
${isSent ? `
RESOLVED COMMITMENTS — compare this email against the PENDING COMMITMENTS list above. If Josh's sent email appears to fulfill or address any pending commitment, list the commitment IDs that should be marked complete or in-progress.` : ''}

CLIENT INTELLIGENCE — signals about the client relationship:
- Sentiment: What's the emotional tone? (positive, neutral, concerned, frustrated, excited)
- Key topics: What subjects are being discussed that matter for coaching/consulting?
- Relationship signals: Any signs of strengthening or weakening relationship?
- Wins or concerns: Client successes to celebrate or problems to address
- Org dynamics: Political dynamics, personnel changes, strategic shifts mentioned

PREP VALUE — information useful for upcoming sessions:
- Topics the client is thinking about right now
- Questions or concerns they've raised
- Context Josh should know before next meeting
- Callbacks: specific things Josh could reference in next conversation to show he's paying attention

CONTACT DISCOVERY — any new people mentioned who aren't in the known contacts list

Return JSON only (no markdown, no code blocks):
{
  "email_category": "client|internal|vendor|newsletter|personal|scheduling",
  "is_noise": false,
  "direction": "${isSent ? 'sent' : 'received'}",
  "org_match": "org_name or null",
  "email_summary": "Brief summary of what this email is about",
  "needs_reply": ${isSent ? 'false' : 'true/false'},
  "reply_urgency": "${isSent ? 'none' : 'today|this_week|no_rush|none'}",
  "sentiment": "positive|neutral|concerned|frustrated|excited",
  "client_intelligence": {
    "key_topics": ["topic1", "topic2"],
    "relationship_signals": "description or null",
    "wins": ["win1"],
    "concerns": ["concern1"],
    "org_dynamics": "description or null"
  },
  "prep_value": {
    "callback_opportunities": ["Something specific Josh can reference later"],
    "topics_on_their_mind": ["topic1"],
    "context_for_next_meeting": "Brief context note or null"
  },
  "new_contacts_discovered": [
    {
      "name": "Person Name",
      "apparent_role": "Their role",
      "organization": "Org name or null",
      "email": "email or null"
    }
  ],
  "commitments": [
    {
      "title": "Short action item title",
      "description": "More detail",
      "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep|internal|note_to_self",
      "owner": "josh|other",
      "other_party": "Name of the other person involved",
      "suggested_due": "ISO date string or null",
      "confidence": "high|medium|low",
      "source_quote": "Exact quote from email"
    }
  ],
  "resolved_commitment_ids": ["commitment-uuid-1"]${isSent ? ' // IDs from PENDING COMMITMENTS that this email resolves' : ''},
  "auto_accept": true/false
}

Set "auto_accept": true ONLY if ALL commitments are high-confidence and clearly actionable. Otherwise false.
If is_noise is true, return minimal fields with empty arrays.
Be thorough but avoid fabricating intelligence that isn't supported by the email content.`,
      },
    ],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No AI response received');
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }
  const extraction = JSON.parse(jsonStr);

  // Match org name to ID
  let matchedOrgId: string | null = null;
  if (extraction.org_match) {
    const matchedOrg = orgs.find(
      (o) => o.name.toLowerCase() === extraction.org_match.toLowerCase()
    );
    if (matchedOrg) matchedOrgId = matchedOrg.id;
  }

  // Determine review status based on intelligence
  let reviewStatus = 'pending';
  if (extraction.is_noise) {
    reviewStatus = 'dismissed';
  } else if (isSent) {
    // Sent emails don't need review — they're Josh's own actions
    reviewStatus = 'accepted';
  } else if (extraction.auto_accept && extraction.commitments?.length > 0) {
    reviewStatus = 'accepted';
  }

  // Store the extraction in the email record
  await supabase
    .from('emails')
    .update({
      ai_extraction: extraction,
      org_id: matchedOrgId,
      is_processed: true,
      review_status: reviewStatus,
    })
    .eq('id', email.id);

  // Auto-discover contacts from received emails
  const createdContactIds: string[] = [];
  if (!isSent && !extraction.is_noise && extraction.new_contacts_discovered?.length > 0) {
    for (const discovered of extraction.new_contacts_discovered) {
      try {
        // Skip entries without a name
        if (!discovered.name?.trim()) continue;

        // If the discovered contact has an email, check for duplicates
        if (discovered.email) {
          const { data: existingByEmail } = await supabase
            .from('contacts')
            .select('id')
            .ilike('email', discovered.email.trim())
            .limit(1);

          if (existingByEmail && existingByEmail.length > 0) continue;
        }

        // Also check by name + org to avoid duplicates when email is unknown
        if (!discovered.email) {
          const nameQuery = supabase
            .from('contacts')
            .select('id')
            .ilike('name', discovered.name.trim())
            .limit(1);

          // Scope to same org if we have one
          if (matchedOrgId) {
            nameQuery.eq('org_id', matchedOrgId);
          }

          const { data: existingByName } = await nameQuery;
          if (existingByName && existingByName.length > 0) continue;
        }

        // Try to match org from the discovered contact's organization field
        let contactOrgId = matchedOrgId;
        if (!contactOrgId && discovered.organization) {
          const discoveredOrg = orgs.find(
            (o) => o.name.toLowerCase() === discovered.organization.toLowerCase()
          );
          if (discoveredOrg) contactOrgId = discoveredOrg.id;
        }

        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            name: discovered.name.trim(),
            email: discovered.email?.trim() || null,
            role: discovered.apparent_role || null,
            org_id: contactOrgId,
            category: 'business',
            relationship_type: 'discovered',
            notes: 'Auto-discovered from email',
          })
          .select('id')
          .single();

        if (!contactError && newContact) {
          createdContactIds.push(newContact.id);
        }
      } catch (contactErr) {
        // Log but don't break email processing
        console.error('Failed to auto-create contact from email discovery:', contactErr);
      }
    }

    // Update the email's ai_extraction to note which contacts were created
    if (createdContactIds.length > 0) {
      const updatedExtraction = {
        ...extraction,
        contacts_auto_created: createdContactIds.length,
        contacts_auto_created_ids: createdContactIds,
      };
      await supabase
        .from('emails')
        .update({ ai_extraction: updatedExtraction })
        .eq('id', email.id);
    }
  }

  // Auto-resolve commitments that Josh's sent email addresses
  if (isSent && extraction.resolved_commitment_ids?.length > 0) {
    for (const commitmentId of extraction.resolved_commitment_ids) {
      // Verify the commitment exists and is pending
      const { data: existing } = await supabase
        .from('commitments')
        .select('id, status')
        .eq('id', commitmentId)
        .in('status', ['pending', 'in_progress', 'waiting'])
        .single();

      if (existing) {
        await supabase
          .from('commitments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', commitmentId);

        // Log the auto-completion
        await supabase.from('commitment_activity').insert({
          commitment_id: commitmentId,
          activity_type: 'completed',
          description: `Auto-completed: Josh sent email "${email.subject}" which addresses this commitment`,
          metadata: { source: 'email_auto_resolve', email_id: email.id },
        });
      }
    }
  }

  // Auto-create commitments for high-confidence emails (inbox only — sent emails create different signals)
  if (extraction.auto_accept && extraction.commitments?.length > 0 && !extraction.is_noise) {
    for (const commitment of extraction.commitments) {
      // Match contact if possible
      let contactId: string | null = null;
      if (commitment.other_party && contacts) {
        const matchedContact = contacts.find(
          (c: { name: string }) =>
            c.name.toLowerCase().includes(commitment.other_party.toLowerCase()) ||
            commitment.other_party.toLowerCase().includes(c.name.toLowerCase())
        );
        if (matchedContact) contactId = matchedContact.id;
      }

      await supabase.from('commitments').insert({
        title: commitment.title,
        description: commitment.description,
        commitment_type: commitment.commitment_type,
        owner: commitment.owner || 'josh',
        other_party: commitment.other_party,
        due_date: commitment.suggested_due || null,
        status: commitment.owner === 'other' ? 'waiting' : 'pending',
        org_id: matchedOrgId,
        contact_id: contactId,
        source: 'email',
        source_ref: `email:${email.id}`,
        priority_score: 50,
      });
    }
  }

  return extraction;
}

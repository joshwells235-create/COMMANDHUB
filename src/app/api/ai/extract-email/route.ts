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
  // Fetch orgs and contacts for matching context
  const { data: orgs } = await supabase
    .from('organizations')
    .select('name, id, strategic_value, status');

  const { data: contacts } = await supabase
    .from('contacts')
    .select('name, id, org_id, role, email, relationship_type');

  const orgList = (orgs || []).map((o) => `${o.name} (${o.status}, ${o.strategic_value})`).join(', ');
  const contactList = (contacts || [])
    .map((c) => {
      const org = orgs?.find((o) => o.id === c.org_id);
      return `${c.name}${org ? ` (${org.name})` : ''}${c.role ? ` - ${c.role}` : ''}${c.email ? ` <${c.email}>` : ''}`;
    })
    .join('\n');

  const recipients = Array.isArray(email.recipients)
    ? (email.recipients as Array<{ name?: string; address?: string; type?: string }>)
        .map((r) => `${r.name || ''} <${r.address || ''}> (${r.type || 'to'})`)
        .join(', ')
    : 'Unknown';

  const client = new Anthropic();
  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are an executive assistant and intelligence analyst for Josh Wells, a Partner at LeadShift, a leadership development consulting firm. You are analyzing an email to extract actionable intelligence — not just commitments, but everything useful for client relationships, session prep, and business development.

Known organizations Josh works with: ${orgList}
Known contacts:
${contactList}

Email Details:
  Subject: ${email.subject || 'No subject'}
  From: ${email.sender || 'Unknown'} <${email.sender_email || ''}>
  To/CC: ${recipients}
  Received: ${email.received_at || 'Unknown'}
  Body:
${email.body_text || email.body_preview || 'No body'}

STEP 1 — CLASSIFY THIS EMAIL:
Determine the category: client (from/about a client org), internal (LeadShift team), vendor (tools/services), newsletter (marketing/automated), personal, or scheduling.
If it's a newsletter or automated marketing email, set is_noise: true and skip detailed extraction.

STEP 2 — EXTRACT INTELLIGENCE:
For non-noise emails, extract:

COMMITMENTS — any action items, promises, asks, or follow-ups:
1. PROMISES JOSH MADE - things Josh said he would do
2. ASKS OF JOSH - direct requests made to Josh
3. PROMISES OTHERS MADE TO JOSH - things Josh should track as waiting_on
4. IMPLICIT FOLLOW-UPS - proposals need follow-up, questions need responses, meetings need prep

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
- Callbacks: specific things Josh could reference in next conversation to show he's paying attention ("You mentioned X in your email...")

CONTACT DISCOVERY — any new people mentioned who aren't in the known contacts list:
- Name, apparent role, organization, email if visible

Return JSON only (no markdown, no code blocks):
{
  "email_category": "client|internal|vendor|newsletter|personal|scheduling",
  "is_noise": false,
  "org_match": "org_name or null",
  "email_summary": "Brief summary of what this email is about",
  "needs_reply": true/false,
  "reply_urgency": "today|this_week|no_rush|none",
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
      "description": "More detail about what needs to be done",
      "commitment_type": "promise_made|ask_received|follow_up|waiting_on|deliverable|prep|internal|note_to_self",
      "owner": "josh|other",
      "other_party": "Name of the other person involved",
      "suggested_due": "ISO date string or null",
      "confidence": "high|medium|low",
      "source_quote": "Exact quote from email that indicates this commitment"
    }
  ],
  "auto_accept": true/false
}

Set "auto_accept": true ONLY if ALL commitments are high-confidence and clearly actionable. Otherwise false.
If is_noise is true, return minimal fields: email_category, is_noise, org_match (null), email_summary, needs_reply (false), reply_urgency ("none"), sentiment ("neutral"), and empty arrays for everything else.
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
    const matchedOrg = orgs?.find(
      (o) => o.name.toLowerCase() === extraction.org_match.toLowerCase()
    );
    if (matchedOrg) matchedOrgId = matchedOrg.id;
  }

  // Determine review status based on intelligence
  let reviewStatus = 'pending';
  if (extraction.is_noise) {
    reviewStatus = 'dismissed';
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

  // Auto-create commitments for high-confidence auto-accept emails
  if (extraction.auto_accept && extraction.commitments?.length > 0 && !extraction.is_noise) {
    for (const commitment of extraction.commitments) {
      // Match contact if possible
      let contactId: string | null = null;
      if (commitment.other_party && contacts) {
        const matchedContact = contacts.find(
          (c) => c.name.toLowerCase().includes(commitment.other_party.toLowerCase()) ||
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

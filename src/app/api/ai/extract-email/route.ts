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
        content: `You are an executive assistant for Josh Wells, a Partner at LeadShift, a leadership development consulting firm. You are analyzing an email to extract any commitments, action items, or follow-ups.

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

Analyze this email carefully and extract ALL commitments. Think about:

1. PROMISES JOSH MADE in this email - things Josh explicitly said he would do ("I'll send that over", "I will follow up", "Let me schedule that")
2. ASKS OF JOSH from others - direct requests made to Josh ("Can you send...", "Please review...", "We need you to...")
3. SOFT ASKS - implicit expectations that aren't directly stated but are clearly expected ("It would be great if...", social obligations, implied next steps)
4. PROMISES OTHERS MADE TO JOSH - things others said they would do that Josh should track as waiting_on items ("I'll get back to you", "We will send the report")
5. IMPLICIT FOLLOW-UPS - if Josh sent a proposal, he needs to follow up; if someone asked a question, it needs a response; if a meeting was referenced, there may be prep needed

For each commitment, determine the commitment_type from: promise_made, ask_received, follow_up, waiting_on, deliverable, prep, internal, note_to_self

Also determine:
- org_match: Which known organization does this email relate to? Match against the known list. null if no match.
- email_summary: A 1-2 sentence summary of what this email is about.
- needs_reply: Does Josh need to reply to this email? (true/false)
- reply_urgency: How urgently does Josh need to reply? (today/this_week/no_rush/none)

Return JSON only (no markdown, no code blocks):
{
  "org_match": "org_name or null",
  "email_summary": "Brief summary of the email",
  "needs_reply": true/false,
  "reply_urgency": "today|this_week|no_rush|none",
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
  ]
}

If there are no commitments at all, return an empty commitments array. Be thorough but avoid fabricating commitments that aren't supported by the email content.`,
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

  // Store the extraction in the email record
  await supabase
    .from('emails')
    .update({
      ai_extraction: extraction,
      org_id: matchedOrgId,
      is_processed: true,
      review_status: 'pending',
    })
    .eq('id', email.id);

  return extraction;
}

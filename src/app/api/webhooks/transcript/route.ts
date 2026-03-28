import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { autoDetectOrganization } from '@/lib/auto-detect-org';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Auth helper – accepts Bearer token or x-webhook-secret header
// ---------------------------------------------------------------------------
function authenticateRequest(request: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('WEBHOOK_SECRET env var is not configured');
    return false;
  }

  // Check x-webhook-secret header first
  const headerSecret = request.headers.get('x-webhook-secret');
  if (headerSecret === secret) return true;

  // Check Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token === secret) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// GET – health / status for Zapier test step
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!authenticateRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/transcript',
    accepts: 'POST',
    required_fields: ['transcript_text'],
    optional_fields: [
      'source',
      'title',
      'summary',
      'date',
      'duration_minutes',
      'participants',
      'meeting_type',
      'metadata',
    ],
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// POST – ingest a transcript from Zapier (Plaud / Otter / manual)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!authenticateRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const {
      source = 'manual',
      title,
      transcript_text,
      summary,
      date,
      duration_minutes,
      participants,
      meeting_type,
      metadata,
    } = body as {
      source?: string;
      title?: string;
      transcript_text?: string;
      summary?: string;
      date?: string;
      duration_minutes?: number;
      participants?: string[];
      meeting_type?: string;
      metadata?: Record<string, unknown>;
    };

    // ---- Validate required field ----
    if (!transcript_text || typeof transcript_text !== 'string' || transcript_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'transcript_text is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // ---- Derive a title if none provided ----
    const resolvedTitle =
      title ||
      `${source.charAt(0).toUpperCase() + source.slice(1)} transcript – ${new Date(date || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // ---- Classify personal vs business and match org ----
    const classification = await classifyAndMatchOrganization(
      supabase,
      resolvedTitle,
      transcript_text,
      source,
      participants
    );

    const orgId = classification.orgId;
    const transcriptCategory = classification.category;

    // ---- Normalise participants into the shape the DB expects ----
    const participantRecords = Array.isArray(participants)
      ? participants.map((p) => (typeof p === 'string' ? { name: p } : p))
      : null;

    // ---- Insert transcript record ----
    const transcriptMetadata = {
      ...(metadata || {}),
      ...(classification.personalArea ? { personal_area: classification.personalArea } : {}),
    };

    const { data: transcript, error: insertError } = await supabase
      .from('transcripts')
      .insert({
        title: resolvedTitle,
        org_id: orgId,
        transcript_date: date || new Date().toISOString(),
        transcript_type: meeting_type || null,
        category: transcriptCategory,
        duration_minutes: duration_minutes || null,
        participants: participantRecords,
        raw_text: transcript_text,
        summary: summary || null,
        review_status: 'pending',
        source: source,
        webhook_metadata: metadata || null,
        metadata: Object.keys(transcriptMetadata).length > 0 ? transcriptMetadata : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating transcript via webhook:', insertError);
      return NextResponse.json(
        { error: 'Failed to create transcript', details: insertError.message },
        { status: 500 }
      );
    }

    // ---- Trigger AI processing pipeline (fire-and-forget) ----
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    try {
      fetch(`${appUrl}/api/transcripts/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript_id: transcript.id }),
      }).catch((err) => {
        console.error('Background processing request failed:', err);
      });
    } catch (triggerError) {
      // Non-fatal – transcript is already saved
      console.error('Error triggering processing pipeline:', triggerError);
    }

    return NextResponse.json(
      {
        success: true,
        transcript_id: transcript.id,
        title: resolvedTitle,
        org_id: orgId,
        org_matched: orgId !== null,
        category: transcriptCategory,
        message: 'Transcript ingested successfully. AI processing triggered.',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Webhook transcript ingestion error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook payload' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Classification result – personal vs business + org matching
// ---------------------------------------------------------------------------
interface TranscriptClassification {
  category: 'business' | 'personal';
  personalArea: string | null;
  orgId: string | null;
}

// ---------------------------------------------------------------------------
// Classify transcript (personal vs business) and match org when business
// ---------------------------------------------------------------------------
async function classifyAndMatchOrganization(
  supabase: ReturnType<typeof createServerClient>,
  title: string,
  transcriptText: string,
  source: string,
  participants?: string[]
): Promise<TranscriptClassification> {
  try {
    // First, use Claude to classify personal vs business AND extract org info
    const classification = await extractClassificationAndOrg(supabase, title, transcriptText, source);

    // If personal, skip org matching entirely
    if (classification.isPersonal) {
      return {
        category: 'personal',
        personalArea: classification.personalArea,
        orgId: null,
      };
    }

    // Business transcript – try to match an existing org first
    // 1. Fetch all organisations
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgs && orgs.length > 0) {
      const titleLower = title.toLowerCase();

      // Check if any org name appears in the title (case-insensitive)
      for (const org of orgs) {
        if (titleLower.includes(org.name.toLowerCase())) {
          return { category: 'business', personalArea: null, orgId: org.id };
        }
      }

      // Also check common abbreviations / acronyms from the title
      const titleWords = titleLower.split(/[\s\-–—,]+/).filter((w) => w.length >= 2);
      for (const org of orgs) {
        const orgNameLower = org.name.toLowerCase();
        if (titleWords.includes(orgNameLower)) {
          return { category: 'business', personalArea: null, orgId: org.id };
        }
      }
    }

    // 2. Try matching participants against contacts
    if (participants && participants.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, org_id')
        .not('org_id', 'is', null);

      if (contacts && contacts.length > 0) {
        for (const participant of participants) {
          const participantLower = (typeof participant === 'string' ? participant : '').toLowerCase();
          if (!participantLower) continue;

          for (const contact of contacts) {
            const contactNameLower = contact.name.toLowerCase();
            if (
              contactNameLower === participantLower ||
              contactNameLower.includes(participantLower) ||
              participantLower.includes(contactNameLower)
            ) {
              return { category: 'business', personalArea: null, orgId: contact.org_id };
            }
          }
        }
      }
    }

    // 3. If Claude extracted an org name, create it
    if (classification.orgId) {
      return { category: 'business', personalArea: null, orgId: classification.orgId };
    }

    // 4. Try auto-detect from participant emails
    if (participants && participants.length > 0) {
      for (const participant of participants) {
        const raw = typeof participant === 'string' ? participant : '';
        const emailMatch = raw.match(/<([^>]+@[^>]+)>/) || raw.match(/([^\s]+@[^\s]+)/);
        if (!emailMatch) continue;

        const email = emailMatch[1];
        const namePart = raw.replace(/<[^>]+>/, '').trim();
        const displayName = namePart || email.split('@')[0];

        const result = await autoDetectOrganization(displayName, email, title, transcriptText.slice(0, 200));
        if (result) return { category: 'business', personalArea: null, orgId: result.org_id };
      }
    }

    return { category: 'business', personalArea: null, orgId: null };
  } catch (error) {
    console.error('Error during classification/org matching:', error);
    return { category: 'business', personalArea: null, orgId: null };
  }
}

// ---------------------------------------------------------------------------
// Use Claude to classify personal/business AND extract org details, then create records
// ---------------------------------------------------------------------------
async function extractClassificationAndOrg(
  supabase: ReturnType<typeof createServerClient>,
  title: string,
  transcriptText: string,
  source: string
): Promise<{ isPersonal: boolean; personalArea: string | null; orgId: string | null }> {
  try {
    const anthropic = new Anthropic();

    // Use the title and first ~500 words of the transcript for context
    const words = transcriptText.split(/\s+/);
    const opening = words.slice(0, 500).join(' ');

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this transcript title and opening text. First determine if this is a PERSONAL conversation (doctor visit, contractor, family, personal finance, social, etc.) or a BUSINESS conversation (client meeting, prospect call, coaching session, etc.).

Title: ${title}

Transcript opening:
${opening}

Return ONLY valid JSON (no markdown fences) with this structure:
{
  "is_personal": true/false,
  "personal_area": "health" | "family" | "finance" | "home" | "social" | "legal" | "travel" | null,
  "org_name": "Name of the external organization/prospect, or null if personal or internal meeting",
  "industry": "Industry if detectable, or null",
  "contact_names": ["List of external participant names mentioned"],
  "meeting_type": "e.g. sales, discovery, check-in, onboarding, internal, doctor, contractor, personal, etc."
}

If this is a personal conversation (doctor, dentist, contractor, family discussion, personal finance advisor, etc.), set is_personal to true, personal_area to the relevant area, and org_name to null.
If this is an internal team meeting with no external organization, set is_personal to false and org_name to null.`,
        },
      ],
    });

    // Parse the Claude response
    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';
    let extracted: {
      is_personal: boolean;
      personal_area: string | null;
      org_name: string | null;
      industry: string | null;
      contact_names: string[];
      meeting_type: string | null;
    };

    try {
      extracted = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse Claude extraction response:', responseText);
      return { isPersonal: false, personalArea: null, orgId: null };
    }

    // If personal, return immediately — no org creation needed
    if (extracted.is_personal) {
      return { isPersonal: true, personalArea: extracted.personal_area, orgId: null };
    }

    // If Claude couldn't identify an org (e.g. internal meeting), return null
    if (!extracted.org_name) {
      return { isPersonal: false, personalArea: null, orgId: null };
    }

    // Create the new organization
    const today = new Date().toISOString().split('T')[0];
    const { data: newOrg, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: extracted.org_name,
        industry: extracted.industry || null,
        status: 'prospect',
        strategic_value: 'emerging',
        notes: `Auto-created from ${source} transcript on ${today}`,
      })
      .select('id')
      .single();

    if (orgError || !newOrg) {
      console.error('Error creating organization:', orgError);
      return { isPersonal: false, personalArea: null, orgId: null };
    }

    // Create contact records for identified participants
    if (extracted.contact_names && extracted.contact_names.length > 0) {
      const contactRecords = extracted.contact_names.map((name) => ({
        name,
        org_id: newOrg.id,
        relationship_type: 'prospect',
        notes: `Auto-created from ${source} transcript on ${today}`,
      }));

      const { error: contactError } = await supabase
        .from('contacts')
        .insert(contactRecords);

      if (contactError) {
        console.error('Error creating contacts:', contactError);
      }
    }

    console.log(
      `Auto-created organization "${extracted.org_name}" (${newOrg.id}) with ${extracted.contact_names?.length || 0} contacts`
    );

    return { isPersonal: false, personalArea: null, orgId: newOrg.id };
  } catch (error) {
    console.error('Error in Claude extraction / org creation:', error);
    return { isPersonal: false, personalArea: null, orgId: null };
  }
}

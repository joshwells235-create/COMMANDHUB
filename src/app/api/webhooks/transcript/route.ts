import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

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

    // ---- Fuzzy org / contact matching ----
    const orgId = await matchOrganization(supabase, resolvedTitle, participants);

    // ---- Normalise participants into the shape the DB expects ----
    const participantRecords = Array.isArray(participants)
      ? participants.map((p) => (typeof p === 'string' ? { name: p } : p))
      : null;

    // ---- Insert transcript record ----
    const { data: transcript, error: insertError } = await supabase
      .from('transcripts')
      .insert({
        title: resolvedTitle,
        org_id: orgId,
        transcript_date: date || new Date().toISOString(),
        transcript_type: meeting_type || null,
        duration_minutes: duration_minutes || null,
        participants: participantRecords,
        raw_text: transcript_text,
        summary: summary || null,
        review_status: 'pending',
        source: source,
        webhook_metadata: metadata || null,
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
// Fuzzy organisation matching
// ---------------------------------------------------------------------------
async function matchOrganization(
  supabase: ReturnType<typeof createServerClient>,
  title: string,
  participants?: string[]
): Promise<string | null> {
  try {
    // 1. Fetch all organisations
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgs && orgs.length > 0) {
      const titleLower = title.toLowerCase();

      // Check if any org name appears in the title (case-insensitive)
      for (const org of orgs) {
        if (titleLower.includes(org.name.toLowerCase())) {
          return org.id;
        }
      }

      // Also check common abbreviations / acronyms from the title
      // e.g. "Meeting with Sarah - MMG" should match "MMG" org
      const titleWords = titleLower.split(/[\s\-–—,]+/).filter((w) => w.length >= 2);
      for (const org of orgs) {
        const orgNameLower = org.name.toLowerCase();
        // Check if any word in the title exactly matches the org name
        if (titleWords.includes(orgNameLower)) {
          return org.id;
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
            // Case-insensitive exact name match or substring match
            const contactNameLower = contact.name.toLowerCase();
            if (
              contactNameLower === participantLower ||
              contactNameLower.includes(participantLower) ||
              participantLower.includes(contactNameLower)
            ) {
              return contact.org_id;
            }
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error during org matching:', error);
    return null;
  }
}

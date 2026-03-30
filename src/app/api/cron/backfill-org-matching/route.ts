import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { matchOrgByName, matchOrgByContacts, matchOrgBySubject } from '@/lib/match-org';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();

    // Fetch orgs and contacts once for reuse
    const [orgRes, contactRes] = await Promise.all([
      supabase.from('organizations').select('id, name, status'),
      supabase.from('contacts').select('id, name, email, org_id'),
    ]);

    const orgs = orgRes.data || [];
    const contacts = contactRes.data || [];

    const stats = {
      emails_scanned: 0,
      emails_matched_by_ai_org: 0,
      emails_matched_by_contact: 0,
      emails_matched_by_subject: 0,
      calendar_scanned: 0,
      calendar_matched_by_ai_org: 0,
      calendar_matched_by_contact: 0,
      calendar_matched_by_subject: 0,
    };

    // ---------------------------------------------------------------
    // Part 1: Backfill emails where org_id IS NULL
    // ---------------------------------------------------------------
    // Fetch ALL emails without org_id (both processed and unprocessed)
    // so we can match using contacts/subject even when AI hasn't run yet.

    const { data: unmatchedEmails } = await supabase
      .from('emails')
      .select('id, ai_extraction, sender_email, sender, recipients, subject, body_preview')
      .is('org_id', null)
      .limit(1000);

    if (unmatchedEmails) {
      stats.emails_scanned = unmatchedEmails.length;

      for (const email of unmatchedEmails) {
        let matchedOrgId: string | null = null;
        let matchSource = '';

        // Strategy 1: Use AI extraction org_match with fuzzy matching
        const extraction = email.ai_extraction as Record<string, unknown> | null;
        if (extraction?.org_match) {
          const matched = matchOrgByName(extraction.org_match as string, orgs);
          if (matched) {
            matchedOrgId = matched.id;
            matchSource = 'ai_org';
          }
        }

        // Strategy 2: Match sender/recipient emails against contacts
        if (!matchedOrgId) {
          const senderEmails = [email.sender_email].filter(Boolean) as string[];
          const recipientEmails = Array.isArray(email.recipients)
            ? (email.recipients as Array<{ address?: string }>)
                .map((r) => r.address)
                .filter(Boolean) as string[]
            : [];
          const allEmails = [...senderEmails, ...recipientEmails];
          const senderNames = [email.sender].filter(Boolean) as string[];

          const orgId = matchOrgByContacts(allEmails, senderNames, contacts);
          if (orgId) {
            matchedOrgId = orgId;
            matchSource = 'contact';
          }
        }

        // Strategy 3: Match email subject against org names
        if (!matchedOrgId && email.subject) {
          const matched = matchOrgBySubject(email.subject, orgs);
          if (matched) {
            matchedOrgId = matched.id;
            matchSource = 'subject';
          }
        }

        if (matchedOrgId) {
          await supabase
            .from('emails')
            .update({ org_id: matchedOrgId })
            .eq('id', email.id);

          if (matchSource === 'ai_org') stats.emails_matched_by_ai_org++;
          else if (matchSource === 'contact') stats.emails_matched_by_contact++;
          else if (matchSource === 'subject') stats.emails_matched_by_subject++;
        }
      }
    }

    // ---------------------------------------------------------------
    // Part 2: Backfill calendar events where org_id IS NULL
    // ---------------------------------------------------------------

    const { data: unmatchedEvents } = await supabase
      .from('calendar_events')
      .select('id, subject, attendees, ai_analysis, body_preview')
      .is('org_id', null)
      .limit(1000);

    if (unmatchedEvents) {
      stats.calendar_scanned = unmatchedEvents.length;

      for (const event of unmatchedEvents) {
        let matchedOrgId: string | null = null;
        let matchSource = '';

        // Strategy 1: Use AI analysis org_match with fuzzy matching
        const analysis = event.ai_analysis as Record<string, unknown> | null;
        if (analysis?.org_match) {
          const matched = matchOrgByName(analysis.org_match as string, orgs);
          if (matched) {
            matchedOrgId = matched.id;
            matchSource = 'ai_org';
          }
        }

        // Strategy 2: Match attendee emails/names against contacts
        if (!matchedOrgId && event.attendees) {
          const attendeeList = event.attendees as Array<{
            emailAddress?: { name?: string; address?: string };
          }>;
          const attendeeEmails = attendeeList
            .map((a) => a.emailAddress?.address)
            .filter(Boolean) as string[];
          const attendeeNames = attendeeList
            .map((a) => a.emailAddress?.name)
            .filter(Boolean) as string[];

          const orgId = matchOrgByContacts(attendeeEmails, attendeeNames, contacts);
          if (orgId) {
            matchedOrgId = orgId;
            matchSource = 'contact';
          }
        }

        // Strategy 3: Match event subject against org names
        if (!matchedOrgId && event.subject) {
          const matched = matchOrgBySubject(event.subject, orgs);
          if (matched) {
            matchedOrgId = matched.id;
            matchSource = 'subject';
          }
        }

        if (matchedOrgId) {
          await supabase
            .from('calendar_events')
            .update({ org_id: matchedOrgId })
            .eq('id', event.id);

          if (matchSource === 'ai_org') stats.calendar_matched_by_ai_org++;
          else if (matchSource === 'contact') stats.calendar_matched_by_contact++;
          else if (matchSource === 'subject') stats.calendar_matched_by_subject++;
        }
      }
    }

    const totalEmailsMatched =
      stats.emails_matched_by_ai_org +
      stats.emails_matched_by_contact +
      stats.emails_matched_by_subject;

    const totalCalendarMatched =
      stats.calendar_matched_by_ai_org +
      stats.calendar_matched_by_contact +
      stats.calendar_matched_by_subject;

    return NextResponse.json({
      success: true,
      message: `Backfill complete: ${totalEmailsMatched}/${stats.emails_scanned} emails matched, ${totalCalendarMatched}/${stats.calendar_scanned} calendar events matched`,
      stats,
    });
  } catch (err) {
    console.error('Backfill org-matching error:', err);
    return NextResponse.json(
      {
        error: 'Backfill failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

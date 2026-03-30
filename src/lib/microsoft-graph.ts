import { createServerClient } from '@/lib/supabase/server';

/**
 * Convert a naive datetime string from Microsoft Graph (Eastern Time, no offset)
 * into a proper ISO string with UTC offset.
 * Graph returns e.g. "2026-03-30T14:00:00.0000000" when Prefer header is Eastern.
 * We need to tag it with the correct ET offset so consumers interpret it correctly.
 */
function easternToISO(naiveDatetime: string | undefined): string | undefined {
  if (!naiveDatetime) return undefined;
  // If it already has a timezone offset (Z, +, -), return as-is
  if (/[Z+-]\d{0,4}$/.test(naiveDatetime.replace(/\.0+$/, ''))) return naiveDatetime;
  // Determine if the date falls in EDT or EST
  // EDT: second Sunday in March to first Sunday in November
  const d = new Date(naiveDatetime); // parsed as UTC, but we just need month/day
  const month = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();
  const dayOfWeek = d.getUTCDay(); // 0=Sun
  let isEDT = false;
  if (month > 2 && month < 10) {
    isEDT = true; // Apr-Oct always EDT
  } else if (month === 2) {
    // March: EDT starts second Sunday
    const secondSunday = 14 - new Date(d.getUTCFullYear(), 2, 1).getDay();
    isEDT = day > secondSunday || (day === secondSunday && dayOfWeek === 0);
  } else if (month === 10) {
    // November: EST starts first Sunday
    const firstSunday = 7 - new Date(d.getUTCFullYear(), 10, 1).getDay();
    isEDT = day < firstSunday;
  }
  // Append the correct offset: EDT = -04:00, EST = -05:00
  const clean = naiveDatetime.replace(/\.0+$/, '');
  return clean + (isEDT ? '-04:00' : '-05:00');
}

const TENANT = process.env.AZURE_TENANT_ID || 'common';
const AUTH_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPES = [
  'Calendars.Read',
  'Calendars.ReadWrite',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Contacts.Read',
  'Files.Read',
  'People.Read',
  'User.Read',
  'offline_access',
];

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: getEnv('AZURE_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: getEnv('MICROSOFT_REDIRECT_URI'),
    scope: SCOPES.join(' '),
    response_mode: 'query',
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getEnv('MICROSOFT_REDIRECT_URI'),
    client_id: getEnv('AZURE_CLIENT_ID'),
    client_secret: getEnv('AZURE_CLIENT_SECRET'),
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Token exchange failed: ${errorData.error_description || response.statusText}`);
  }

  const tokens = await response.json();

  const supabase = createServerClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('auth_tokens')
    .upsert(
      {
        provider: 'microsoft',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      },
      { onConflict: 'provider' }
    );

  return tokens;
}

export async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getEnv('AZURE_CLIENT_ID'),
    client_secret: getEnv('AZURE_CLIENT_SECRET'),
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`);
  }

  const tokens = await response.json();

  const supabase = createServerClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from('auth_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: expiresAt,
    })
    .eq('provider', 'microsoft');

  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('auth_tokens')
    .select('*')
    .eq('provider', 'microsoft')
    .single();

  if (error || !data) {
    throw new Error('No Microsoft tokens found. Please connect your Microsoft account.');
  }

  const expiresAt = new Date(data.expires_at).getTime();
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

  if (expiresAt <= fiveMinutesFromNow) {
    const refreshed = await refreshAccessToken(data.refresh_token);
    return refreshed.access_token;
  }

  return data.access_token;
}

export async function fetchCalendarEvents(startDate: string, endDate: string) {
  const accessToken = await getValidAccessToken();

  let allEvents: Record<string, unknown>[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}&$top=100&$orderby=start/dateTime`;

  while (nextUrl) {
    const fetchUrl = nextUrl;
    const resp: Response = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="Eastern Standard Time"',
      },
    });

    if (!resp.ok) {
      const errorData = await resp.json();
      throw new Error(`Failed to fetch calendar events: ${errorData.error?.message || resp.statusText}`);
    }

    const body = await resp.json() as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
    allEvents = allEvents.concat(body.value || []);
    nextUrl = body['@odata.nextLink'] || null;
  }

  return allEvents;
}

export async function fetchEmails(sinceDate: string, top: number = 50) {
  const accessToken = await getValidAccessToken();

  const filter = `receivedDateTime ge ${sinceDate}`;
  let allEmails: Record<string, unknown>[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/me/messages?$top=${Math.min(top, 100)}&$orderby=receivedDateTime desc&$filter=${encodeURIComponent(filter)}&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,isRead,conversationId`;

  while (nextUrl && allEmails.length < top) {
    const fetchUrl = nextUrl;
    const response: Response = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch emails: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
    allEmails = allEmails.concat(data.value || []);
    nextUrl = allEmails.length < top ? (data['@odata.nextLink'] || null) : null;
  }

  return allEmails.slice(0, top);
}

export async function fetchSentEmails(sinceDate: string, top: number = 50) {
  const accessToken = await getValidAccessToken();

  const filter = `sentDateTime ge ${sinceDate}`;
  let allEmails: Record<string, unknown>[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/me/mailFolders/sentitems/messages?$top=${Math.min(top, 100)}&$orderby=sentDateTime desc&$filter=${encodeURIComponent(filter)}&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,sentDateTime,receivedDateTime,conversationId`;

  while (nextUrl && allEmails.length < top) {
    const fetchUrl = nextUrl;
    const response: Response = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch sent emails: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as { value?: Record<string, unknown>[]; '@odata.nextLink'?: string };
    allEmails = allEmails.concat(data.value || []);
    nextUrl = allEmails.length < top ? (data['@odata.nextLink'] || null) : null;
  }

  return allEmails.slice(0, top);
}

/**
 * Pre-filter obvious junk/noise emails before AI processing.
 * Returns true if the email should be auto-skipped.
 */
function isObviousJunk(email: Record<string, unknown>): boolean {
  const subject = ((email.subject as string) || '').toLowerCase();
  const senderEmail = ((email.from as { emailAddress?: { address?: string } })?.emailAddress?.address || '').toLowerCase();
  const senderName = ((email.from as { emailAddress?: { name?: string } })?.emailAddress?.name || '').toLowerCase();

  // Automated/no-reply senders
  const noReplySenders = ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'notifications@', 'notify@', 'alerts@', 'updates@', 'news@', 'newsletter@', 'marketing@', 'info@', 'support@'];
  if (noReplySenders.some((s) => senderEmail.includes(s))) return true;

  // Known junk subject patterns
  const junkSubjects = ['unsubscribe', 'your receipt', 'order confirmation', 'shipping confirmation', 'delivery notification', 'password reset', 'verify your email', 'activate your account', 'your subscription', 'weekly digest', 'daily digest', 'newsletter', 'webinar', 'invitation:'];
  if (junkSubjects.some((s) => subject.includes(s))) return true;

  // Automated calendar responses
  if (subject.startsWith('accepted:') || subject.startsWith('declined:') || subject.startsWith('tentatively accepted:')) return true;

  return false;
}

export async function syncEmails() {
  const supabase = createServerClient();

  // Get the last synced email timestamp, or default to 7 days ago
  const { data: lastEmail } = await supabase
    .from('emails')
    .select('received_at')
    .order('received_at', { ascending: false })
    .limit(1)
    .single();

  const sinceDate = lastEmail?.received_at
    || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch inbox and sent in parallel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [inboxEmails, sentEmails] = await Promise.all([
    fetchEmails(sinceDate) as Promise<any[]>,
    fetchSentEmails(sinceDate) as Promise<any[]>,
  ]);

  let totalSynced = 0;

  // Sync inbox emails
  let junkSkipped = 0;
  for (const email of inboxEmails) {
    const sender = email.from?.emailAddress;
    const recipients = [
      ...(email.toRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
        name: r.emailAddress?.name,
        address: r.emailAddress?.address,
        type: 'to',
      })),
      ...(email.ccRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
        name: r.emailAddress?.name,
        address: r.emailAddress?.address,
        type: 'cc',
      })),
    ];

    // Pre-filter obvious junk — mark as processed+dismissed immediately to skip AI
    const junk = isObviousJunk(email);
    if (junk) junkSkipped++;

    await supabase
      .from('emails')
      .upsert(
        {
          ms_message_id: email.id,
          subject: email.subject ?? null,
          sender: sender?.name ?? null,
          sender_email: sender?.address ?? null,
          recipients,
          body_text: email.body?.content ?? null,
          body_preview: email.bodyPreview ?? null,
          received_at: email.receivedDateTime,
          conversation_id: email.conversationId ?? null,
          is_read: email.isRead ?? false,
          folder: 'inbox',
          is_processed: junk,
          review_status: junk ? 'dismissed' : 'pending',
          ...(junk ? { ai_extraction: { is_noise: true, email_category: 'auto_filtered', email_summary: 'Auto-filtered as junk/automated' } } : {}),
        },
        { onConflict: 'ms_message_id', ignoreDuplicates: false }
      );
    totalSynced++;
  }

  // Sync sent emails
  for (const email of sentEmails) {
    const sender = email.from?.emailAddress;
    const recipients = [
      ...(email.toRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
        name: r.emailAddress?.name,
        address: r.emailAddress?.address,
        type: 'to',
      })),
      ...(email.ccRecipients || []).map((r: { emailAddress?: { name?: string; address?: string } }) => ({
        name: r.emailAddress?.name,
        address: r.emailAddress?.address,
        type: 'cc',
      })),
    ];

    await supabase
      .from('emails')
      .upsert(
        {
          ms_message_id: email.id,
          subject: email.subject ?? null,
          sender: sender?.name ?? null,
          sender_email: sender?.address ?? null,
          recipients,
          body_text: email.body?.content ?? null,
          body_preview: email.bodyPreview ?? null,
          received_at: email.receivedDateTime ?? email.sentDateTime,
          sent_at: email.sentDateTime ?? null,
          conversation_id: email.conversationId ?? null,
          is_read: true,
          folder: 'sent',
          is_processed: false,
          review_status: 'pending',
        },
        { onConflict: 'ms_message_id', ignoreDuplicates: false }
      );
    totalSynced++;
  }

  return totalSynced;
}

export async function syncCalendar() {
  const now = new Date();

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 14);

  const events = await fetchCalendarEvents(
    startDate.toISOString(),
    endDate.toISOString()
  );

  const supabase = createServerClient();

  for (const event of events) {
    const start = event.start as { dateTime?: string } | undefined;
    const end = event.end as { dateTime?: string } | undefined;
    const location = event.location as { displayName?: string } | undefined;

    await supabase
      .from('calendar_events')
      .upsert(
        {
          ms_event_id: event.id as string,
          subject: (event.subject as string) ?? null,
          body_preview: (event.bodyPreview as string) ?? null,
          start_time: easternToISO(start?.dateTime),
          end_time: easternToISO(end?.dateTime),
          location: location?.displayName ?? null,
          attendees: event.attendees ?? null,
          is_processed: false,
          raw_data: event,
        },
        { onConflict: 'ms_event_id', ignoreDuplicates: false }
      );
  }
}

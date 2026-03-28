import { createServerClient } from '@/lib/supabase/server';

const TENANT = 'common';
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
  'Tasks.ReadWrite',
  'OnlineMeetings.Read',
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

  const url = `${GRAPH_BASE}/me/calendarView?startDateTime=${startDate}&endDateTime=${endDate}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to fetch calendar events: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.value;
}

export async function fetchEmails(sinceDate: string, top: number = 50) {
  const accessToken = await getValidAccessToken();

  const filter = `receivedDateTime ge ${sinceDate}`;
  const url = `${GRAPH_BASE}/me/messages?$top=${top}&$orderby=receivedDateTime desc&$filter=${encodeURIComponent(filter)}&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,isRead,conversationId`;

  const response = await fetch(url, {
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

  const data = await response.json();
  return data.value;
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

  const emails = await fetchEmails(sinceDate);

  for (const email of emails) {
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
          received_at: email.receivedDateTime,
          is_read: email.isRead ?? false,
          is_processed: false,
          review_status: 'pending',
        },
        { onConflict: 'ms_message_id', ignoreDuplicates: false }
      );
  }

  return emails.length;
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
    await supabase
      .from('calendar_events')
      .upsert(
        {
          ms_event_id: event.id,
          subject: event.subject ?? null,
          body_preview: event.bodyPreview ?? null,
          start_time: event.start?.dateTime,
          end_time: event.end?.dateTime,
          location: event.location?.displayName ?? null,
          attendees: event.attendees ?? null,
          is_processed: false,
          raw_data: event,
        },
        { onConflict: 'ms_event_id', ignoreDuplicates: false }
      );
  }
}

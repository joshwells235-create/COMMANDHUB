export function validateRequest(request: Request): boolean {
  // Option 1: Check for API key in header (for programmatic access)
  const apiKey = request.headers.get('x-api-key');
  if (apiKey && apiKey === process.env.API_SECRET) return true;

  // Option 2: Check for session cookie (for browser access)
  const cookie = request.headers.get('cookie') || '';
  const sessionMatch = cookie.match(/ch_session=([^;]+)/);
  if (sessionMatch && sessionMatch[1] === process.env.API_SECRET) return true;

  // Option 3: Allow requests from same origin (browser requests from the app itself)
  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (appUrl && origin.startsWith(appUrl)) return true;

  // Allow localhost in development
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;

  return false;
}

export function unauthorizedResponse() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

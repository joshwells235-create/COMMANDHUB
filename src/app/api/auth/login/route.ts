import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { passphrase } = await request.json();
    const secret = process.env.API_SECRET;

    if (!secret) {
      console.error('API_SECRET env var is not configured');
      return Response.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    if (passphrase !== secret) {
      return Response.json({ error: 'Invalid passphrase' }, { status: 401 });
    }

    // Set session cookie - httpOnly, secure, 30 days
    const response = Response.json({ ok: true });
    const headers = new Headers(response.headers);
    const isProduction = process.env.NODE_ENV === 'production';

    headers.append(
      'Set-Cookie',
      `ch_session=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${isProduction ? '; Secure' : ''}`
    );

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
}

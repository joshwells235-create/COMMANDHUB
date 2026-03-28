import { NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/microsoft-graph';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
  }

  try {
    await exchangeCodeForTokens(code);
    return NextResponse.redirect(new URL('/', request.url));
  } catch {
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
  }
}

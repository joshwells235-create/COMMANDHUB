import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't need auth
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/microsoft',
  '/api/auth/callback',
  '/api/webhooks/',
  '/api/cron/',
  '/api/transcripts/reprocess',
  '/api/transcripts/process',
  '/manifest.json',
  '/sw.js',
  '/icon.svg',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Skip auth for static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check session cookie
  const session = request.cookies.get('ch_session')?.value;
  const secret = process.env.API_SECRET;

  if (secret && session === secret) {
    return NextResponse.next();
  }

  // For API routes, return 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // For page routes, redirect to login
  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

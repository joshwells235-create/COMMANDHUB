import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow: static files, Next.js internals, manifest, service worker
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/icon.svg'
  ) {
    return NextResponse.next();
  }

  // Allow: login page and login API
  if (pathname === '/login' || pathname === '/api/auth/login') {
    return NextResponse.next();
  }

  // Allow: webhook routes (have their own auth)
  if (pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  // Allow: cron routes (have their own auth)
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  // Allow: OAuth flow routes
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Check for valid session cookie
  const sessionCookie = request.cookies.get('ch_session');
  const secret = process.env.API_SECRET;

  if (secret && sessionCookie?.value === secret) {
    return NextResponse.next();
  }

  // For API routes, also check x-api-key header and same-origin
  if (pathname.startsWith('/api/')) {
    const apiKey = request.headers.get('x-api-key');
    if (apiKey && apiKey === secret) {
      return NextResponse.next();
    }

    // Allow same-origin requests (browser fetches from authenticated pages)
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    if (appUrl && origin.startsWith(appUrl)) {
      return NextResponse.next();
    }

    // Allow localhost in development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return NextResponse.next();
    }

    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // For page routes, redirect to login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image).*)',
  ],
};

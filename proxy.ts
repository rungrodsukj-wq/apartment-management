// proxy.ts
import { NextRequest, NextResponse } from 'next/server';

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Static and public asset paths to bypass completely
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path.includes('.')
  ) {
    return NextResponse.next();
  }

  const isPublicRoute = path === '/login' || path === '/register' || path === '/pending';

  // Optimistic check for Supabase session cookie
  const allCookies = req.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    cookie => cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')
  );

  if (!hasAuthCookie && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', req.nextUrl));
  }

  if (hasAuthCookie && (path === '/login' || path === '/register')) {
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};

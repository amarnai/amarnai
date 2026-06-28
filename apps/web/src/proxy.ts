import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { matchLocale, isSupportedLocale } from "@amarnai/i18n";

const LOCALE_COOKIE = "amarnai_locale";

function resolveLocale(req: Parameters<Parameters<typeof auth>[0]>[0]): string {
  // Explicit cookie override (manual switcher or prior detection) wins.
  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && isSupportedLocale(cookieLocale)) return cookieLocale;

  // Fall back to browser preference.
  const acceptLanguage = req.headers.get("accept-language") ?? "";
  const preferredLocales = acceptLanguage
    .split(",")
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter(Boolean);
  return matchLocale(preferredLocales);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isSignedIn = !!req.auth?.user?.id;

  const isPublic =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/internal") ||
    // The billing routes authenticate themselves and must not be redirected to
    // /sign-in: the webhook verifies the Stripe signature, and the rest accept a
    // Bearer JWT (native mobile clients have no web session cookie) alongside the
    // web cookie session. Each route enforces auth + ownership on its own.
    pathname.startsWith("/api/billing/");

  if (!isSignedIn && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const isEmailVerified = req.auth?.user?.isEmailVerified === true;

  // Verified users have no reason to be on /verify-email.
  if (isSignedIn && isEmailVerified && pathname.startsWith("/verify-email")) {
    return NextResponse.redirect(new URL("/emails", req.url));
  }

  // Signed-in users who haven't verified their email are gated to /verify-email.
  // /verify-email itself requires being signed in but is exempt from this gate.
  if (isSignedIn && !isEmailVerified && !isPublic && !pathname.startsWith("/verify-email")) {
    return NextResponse.redirect(new URL("/verify-email", req.url));
  }

  // Propagate the resolved locale so server components and the LinguiClientProvider
  // can read it without re-parsing the Accept-Language header. The header must be
  // set on the forwarded *request* headers: `headers()` in a Server Component reads
  // the incoming request, not the middleware response, so setting it on the response
  // would leave the layout falling back to the source locale.
  const locale = resolveLocale(req);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-locale", locale);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)"],
};

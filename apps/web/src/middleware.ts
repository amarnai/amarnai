import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isSignedIn = !!req.auth?.user?.id;

  const isPublic =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/internal");

  if (!isSignedIn && !isPublic) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  // Signed-in users who haven't verified their email are gated to /verify-email.
  // /verify-email itself requires being signed in but is exempt from this gate.
  const isEmailVerified = req.auth?.user?.isEmailVerified === true;
  if (isSignedIn && !isEmailVerified && !isPublic && !pathname.startsWith("/verify-email")) {
    return NextResponse.redirect(new URL("/verify-email", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)"],
};

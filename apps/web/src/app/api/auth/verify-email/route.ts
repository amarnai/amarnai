import { NextRequest, NextResponse } from "next/server";
import { db } from "@amarnai/db";
import { auth, unstable_update } from "@/auth";
import { getOrCreateDefaultWorkspace } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const signInUrl = new URL("/sign-in", req.url);

  if (!token) {
    signInUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(signInUrl);
  }

  const record = await db.verificationToken.findUnique({
    where: { token },
    select: { userId: true, type: true, expiresAt: true },
  });

  if (!record || record.type !== "EMAIL_VERIFICATION" || record.expiresAt < new Date()) {
    signInUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(signInUrl);
  }

  await db.user.update({
    where: { id: record.userId },
    data: { emailVerified: new Date() },
  });

  await getOrCreateDefaultWorkspace(record.userId);

  await db.verificationToken.delete({ where: { token } });

  // If the user is signed in on this browser, refresh the JWT so the
  // middleware sees isEmailVerified: true immediately, then go straight to the app.
  const session = await auth();
  if (session?.user?.id === record.userId) {
    await unstable_update({});
    return NextResponse.redirect(new URL("/emails", req.url));
  }

  signInUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(signInUrl);
}

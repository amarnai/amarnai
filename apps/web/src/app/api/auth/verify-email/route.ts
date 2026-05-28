import { NextRequest, NextResponse } from "next/server";
import { db } from "@amarnai/db";
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

  signInUrl.searchParams.set("verified", "1");
  return NextResponse.redirect(signInUrl);
}

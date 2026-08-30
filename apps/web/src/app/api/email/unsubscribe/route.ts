import { NextRequest, NextResponse } from "next/server";
import { db } from "@aziru/db";
import { verifyUnsubscribeToken } from "@aziru/auth/unsubscribe-token";
import { colors } from "@aziru/tokens";

// One-click unsubscribe for weekly lifecycle reminder emails.
//
// The link is stateless: it carries the user id and an HMAC signature over it
// (?u=<userId>&sig=<token>). We verify the signature and flip the per-user
// opt-out flag — no token table to look up. GET serves a small confirmation page
// for humans clicking the footer link; POST implements RFC 8058 one-click so
// Gmail's native "Unsubscribe" affordance works without opening a browser.

async function applyUnsubscribe(
  userId: string | null,
  sig: string | null,
): Promise<boolean> {
  if (!userId || !sig) return false;
  if (!verifyUnsubscribeToken(userId, sig)) return false;
  // updateMany so an unknown/deleted user id is a no-op (still a success to the
  // caller — the desired end state, "this user receives no reminders", holds).
  await db.user.updateMany({
    where: { id: userId },
    data: { lifecycleEmailsEnabled: false },
  });
  return true;
}

function confirmationPage(ok: boolean): NextResponse {
  const heading = ok ? "You're unsubscribed" : "Link invalid";
  const message = ok
    ? "You will no longer receive Amarnai inbox reminder emails. You can re-enable them anytime in your account settings."
    : "This unsubscribe link is invalid or has expired. You can manage email reminders in your account settings.";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} | Amarnai</title></head>
<body style="margin:0;background:${colors.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:48px auto;padding:0 16px;">
    <div style="background:${colors.surface};border:1px solid ${colors.line};border-radius:12px;padding:28px;">
      <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:${colors.accent};">Amarnai</p>
      <h1 style="margin:0 0 12px;font-size:20px;color:${colors.ink};">${heading}</h1>
      <p style="margin:0;color:${colors.ink2};font-size:15px;line-height:1.55;">${message}</p>
    </div>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const ok = await applyUnsubscribe(
    req.nextUrl.searchParams.get("u"),
    req.nextUrl.searchParams.get("sig"),
  );
  return confirmationPage(ok);
}

export async function POST(req: NextRequest) {
  // RFC 8058 one-click: the mail client POSTs to the List-Unsubscribe URL (the
  // user id and signature ride in its query string). Body is ignored.
  const ok = await applyUnsubscribe(
    req.nextUrl.searchParams.get("u"),
    req.nextUrl.searchParams.get("sig"),
  );
  return new NextResponse(null, { status: ok ? 200 : 400 });
}

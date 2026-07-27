"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { signIn, signOut, unstable_update } from "@/auth";
import { db, deleteUserCascade } from "@amarnai/db";
import { cancelSubscriptionsForAccountDeletion } from "@amarnai/billing";
import {
  registerEmail,
  rotateVerificationToken,
  createPasswordResetToken,
  applyPasswordReset,
  checkUserPassword,
} from "@amarnai/auth";
import { RegisterEmailSchema, PasswordSchema } from "@amarnai/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  authActionRateLimited,
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/auth-rate-limit";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountExistsEmail,
  sendGoogleAccountEmail,
} from "@/lib/email";
import { disconnectGmailBeforeDeletion } from "@/lib/gmail-teardown";
import { INVITE_COOKIE, sanitizeInvitePath } from "@/lib/invite-redirect";

// ─── Sign in / out ───────────────────────────────────────────────────────────

// If a workspace invite is pending (cookie set by the accept route), resume it
// after auth; otherwise land on the app home. The cookie is left in place — it
// is cleared by the accept route on success, or by the verify-email route, so an
// unverified user bounced to /verify-email still resumes once they verify.
async function postAuthRedirect(): Promise<string> {
  const store = await cookies();
  return sanitizeInvitePath(store.get(INVITE_COOKIE)?.value);
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: await postAuthRedirect() });
}

export async function credentialsSignInAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const email = (formData.get("email") as string | null) ?? "";
  // Throttle brute force: the web credentials path goes straight through
  // next-auth, so the API's login rate limit does not cover it. FAILURES-ONLY —
  // check before the attempt, record only on failure, clear on success — so a
  // wrong-password flood on a victim's email cannot lock the real user out.
  if (email && (await isLoginBlocked(email))) {
    return { error: "Too many attempts. Please try again in a few minutes." };
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: await postAuthRedirect(),
    });
  } catch (err) {
    // A successful sign-in throws NEXT_REDIRECT — clear the failure counters and
    // re-throw so Next.js handles it as a navigation.
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      if (email) await clearLoginFailures(email);
      throw err;
    }
    if (email) await recordLoginFailure(email);
    return { error: "Invalid email or password" };
  }
  return {};
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = RegisterEmailSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { email } = parsed.data;

  // Throttle per email/IP to stop this endpoint being an email-amplification
  // vector. On trip we return the SAME neutral success without sending anything,
  // so the throttle itself does not leak whether the email is registered.
  if (await authActionRateLimited("register", email, 5)) {
    return { success: true };
  }

  // Email-first: no password is collected here and no session is ever handed
  // back. Every account state returns the SAME neutral success below, so the
  // response cannot reveal whether the email is registered. The correct guidance
  // is delivered by email, which only the real mailbox owner receives.
  const result = await registerEmail({ email });
  try {
    if (result.status === "verify") {
      // Null when a recent resend is still throttled — send nothing.
      if (result.verificationToken) {
        await sendVerificationEmail(email, result.verificationToken);
      }
    } else if (result.status === "already_registered") {
      await sendAccountExistsEmail(email);
    } else {
      await sendGoogleAccountEmail(email);
    }
  } catch (err) {
    // A delivery failure must never change the response (that would leak state).
    console.error("[registerAction] send:", err instanceof Error ? err.message : err);
  }

  return { success: true };
}

// ─── Resend verification ──────────────────────────────────────────────────────

export async function resendVerificationAction(): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: {
      email: true,
      emailVerified: true,
      verificationTokens: {
        where: { type: "EMAIL_VERIFICATION" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (!dbUser) return { error: "User not found" };

  // Stale session: the DB says verified (link clicked in another browser or
  // device) but this JWT still carries isEmailVerified: false, so the middleware
  // keeps gating the user here. Refresh the token from the DB and send them into
  // the app instead of dead-ending on an error.
  if (dbUser.emailVerified) {
    await unstable_update({});
    redirect(await postAuthRedirect());
  }

  const last = dbUser.verificationTokens[0];
  if (last && Date.now() - last.createdAt.getTime() < 60_000) {
    return { error: "Please wait before requesting another email" };
  }

  const token = await rotateVerificationToken(user.id);
  await sendVerificationEmail(dbUser.email, token);
  return { success: true };
}

// ─── Update name ─────────────────────────────────────────────────────────────

export async function updateNameAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  const name = (formData.get("name") as string | null)?.trim() ?? "";

  if (name.length > 100) return { error: "Name must be 100 characters or fewer" };

  await db.user.update({
    where: { id: user.id },
    data: { name: name || null },
  });

  await unstable_update({});

  return { success: true };
}

// ─── Email reminder preference ─────────────────────────────────────────────────

export async function setLifecycleEmailsAction(
  enabled: boolean
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();

  await db.user.update({
    where: { id: user.id },
    data: { lifecycleEmailsEnabled: enabled },
  });

  return { success: true };
}

// ─── Delete account ───────────────────────────────────────────────────────────

export async function deleteAccountAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const user = await requireUser();

  // Step-up re-authentication: password accounts must re-enter their password
  // before this irreversible action. Federated (Google-only) accounts have no
  // password to verify and proceed on their valid session.
  const password = (formData.get("password") as string | null) ?? "";
  const check = await checkUserPassword(user.id, password);
  if (check === "wrong") {
    return { error: "Incorrect password. Please try again." };
  }

  // Cancel queued sorting jobs and revoke Gmail grants for every owned
  // workspace before the rows disappear. Runs while the session is still
  // valid (signOut comes after the transaction). Best-effort: never blocks
  // account deletion.
  const ownedWorkspaces = await db.workspace.findMany({
    where: { ownerUserId: user.id },
    select: { id: true },
  });
  await disconnectGmailBeforeDeletion(
    user.id,
    ownedWorkspaces.map((w) => w.id)
  );

  // Cancel any paid Stripe subscriptions on owned workspaces before the rows are
  // gone, so nobody keeps paying for a deleted account. Never throws — a Stripe
  // failure records a durable retry row the worker reconciles; deletion is never
  // blocked. Must run before deleteUserCascade (it needs the workspace rows).
  await cancelSubscriptionsForAccountDeletion(user.id);

  // Single source of truth for the FK-safe teardown order. Also persists a
  // reset-immune TrialClaim so re-registering the same email cannot mint a new
  // trial.
  await deleteUserCascade(user.id);

  // Session is now invalid — sign out and redirect.
  await signOut({ redirectTo: "/sign-in" });
  return {};
}

// ─── Forgot password ──────────────────────────────────────────────────────────

export async function forgotPasswordAction(
  _prev: { error?: string; success?: boolean; email?: string } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean; email?: string }> {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Invalid email address" };

  // Throttle per email/IP; on trip return the same neutral success as always.
  if (await authActionRateLimited("forgot", email.data, 5)) {
    return { success: true, email: email.data };
  }

  // Silent success — createPasswordResetToken returns null (no email sent) when
  // the account is missing, Google-only, or throttled, never revealing which.
  const token = await createPasswordResetToken(email.data);
  if (token) await sendPasswordResetEmail(email.data, token);
  return { success: true, email: email.data };
}

// ─── Reset password ───────────────────────────────────────────────────────────

const resetSchema = z.object({
  token: z.string().min(1),
  password: PasswordSchema,
});

export async function resetPasswordAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { token, password } = parsed.data;

  const record = await db.verificationToken.findUnique({
    where: { token },
    select: { userId: true, type: true, expiresAt: true },
  });

  if (!record || record.type !== "PASSWORD_RESET") {
    return { error: "Invalid or expired reset link" };
  }
  if (record.expiresAt < new Date()) {
    return { error: "This reset link has expired. Please request a new one." };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Set the password + revoke every other session in one token-first transaction
  // (see applyPasswordReset). A double-submit loses on the token delete and is
  // reported as already-used rather than resetting twice or 500ing.
  const outcome = await applyPasswordReset(record.userId, passwordHash, token);
  if (outcome === "already_used") {
    return { error: "This reset link has already been used. Please request a new one." };
  }

  return { success: true };
}

"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { signIn, signOut, unstable_update } from "@/auth";
import { db } from "@amarnai/db";
import { registerWithPassword, rotateVerificationToken, createPasswordResetToken } from "@amarnai/auth";
import { RegisterCredentialsSchema } from "@amarnai/shared";
import { requireUser } from "@/lib/session";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";
import { disconnectGmailBeforeDeletion } from "@/lib/gmail-teardown";
import { isWaitlistMode } from "@/lib/waitlist";

// ─── Sign in / out ───────────────────────────────────────────────────────────

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: "/emails" });
}

export async function credentialsSignInAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/emails",
    });
  } catch (err) {
    // Re-throw NEXT_REDIRECT so Next.js handles it as a navigation.
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    return { error: "Invalid email or password" };
  }
  return {};
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  // The sign-up page renders the waitlist instead of this form in waitlist
  // mode, but the server must enforce its own policy.
  if (isWaitlistMode()) {
    return { error: "Sign-ups are currently invite-only. Join the waitlist to get access." };
  }

  const parsed = RegisterCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { email, password } = parsed.data;

  const result = await registerWithPassword({ email, password });
  if (result.status === "google_only") {
    return { error: "An account with this email exists. Sign in with Google instead." };
  }
  if (result.status === "exists") {
    return { error: "An account with this email already exists." };
  }

  await sendVerificationEmail(email, result.verificationToken);

  // Sign in immediately — throws NEXT_REDIRECT to /verify-email (middleware gates unverified users there).
  await signIn("credentials", { email, password, redirectTo: "/verify-email" });

  return {};
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
  if (dbUser.emailVerified) return { error: "Email is already verified" };

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

// ─── Delete account ───────────────────────────────────────────────────────────

export async function deleteAccountAction(): Promise<{ error?: string }> {
  const user = await requireUser();

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

  await db.$transaction(async (tx) => {
    const [workspaces, emailAccounts] = await Promise.all([
      tx.workspace.findMany({ where: { ownerUserId: user.id }, select: { id: true } }),
      tx.emailAccount.findMany({ where: { userId: user.id }, select: { id: true } }),
    ]);
    const workspaceIds = workspaces.map((w) => w.id);
    const emailAccountIds = emailAccounts.map((ea) => ea.id);

    const [threads, messages] = await Promise.all([
      tx.emailThread.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true } }),
      tx.emailMessage.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true } }),
    ]);
    const threadIds = threads.map((t) => t.id);
    const messageIds = messages.map((m) => m.id);

    // Delete leaf records first, then work up to User.
    await tx.emailTag.deleteMany({
      where: { OR: [{ emailThreadId: { in: threadIds } }, { emailMessageId: { in: messageIds } }] },
    });
    await tx.draft.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.emailClassification.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.emailMessage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.emailThread.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.tag.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.taxonomyEdge.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.taxonomyNode.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.gmailSyncSettings.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.gmailConnection.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await tx.providerSyncState.deleteMany({ where: { emailAccountId: { in: emailAccountIds } } });
    await tx.emailAddressIdentity.deleteMany({ where: { emailAccountId: { in: emailAccountIds } } });
    // Deleting by userId is only safe because every emailAccount lives in a
    // workspace this user owns: Gmail connect requires the OWNER role, and the
    // OWNER role is only ever granted to the workspace creator (ownerUserId).
    // If ownership transfer or member promotion is ever added, this scope must
    // change with it or threads in surviving workspaces will break this delete.
    await tx.emailAccount.deleteMany({ where: { userId: user.id } });
    await tx.workspaceMember.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.deleteMany({ where: { actorUserId: user.id } });
    await tx.workspace.deleteMany({ where: { ownerUserId: user.id } });
    await tx.verificationToken.deleteMany({ where: { userId: user.id } });
    await tx.userCredential.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });

  // Session is now invalid — sign out and redirect.
  await signOut({ redirectTo: "/sign-in" });
  return {};
}

// ─── Forgot password ──────────────────────────────────────────────────────────

export async function forgotPasswordAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Invalid email address" };

  // Silent success — createPasswordResetToken returns null (no email sent) when
  // the account is missing, Google-only, or throttled, never revealing which.
  const token = await createPasswordResetToken(email.data);
  if (token) await sendPasswordResetEmail(email.data, token);
  return { success: true };
}

// ─── Reset password ───────────────────────────────────────────────────────────

const resetSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
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
  await db.userCredential.upsert({
    where: { userId: record.userId },
    create: { userId: record.userId, passwordHash },
    update: { passwordHash },
  });

  await db.verificationToken.delete({ where: { token } });

  return { success: true };
}

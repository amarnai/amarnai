"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";

// ─── Shared ───────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Sign in / out ───────────────────────────────────────────────────────────

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function credentialsSignInAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
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
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { email, password } = parsed.data;

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, credential: { select: { id: true } } },
  });
  if (existing) {
    if (!existing.credential) {
      return { error: "An account with this email exists. Sign in with Google instead." };
    }
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: {
      email,
      credential: { create: { passwordHash } },
    },
    select: { id: true },
  });

  const token = generateToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      token,
      type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await sendVerificationEmail(email, token);

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

  await db.verificationToken.deleteMany({
    where: { userId: user.id, type: "EMAIL_VERIFICATION" },
  });

  const token = generateToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      token,
      type: "EMAIL_VERIFICATION",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

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

  return { success: true };
}

// ─── Delete account ───────────────────────────────────────────────────────────

export async function deleteAccountAction(): Promise<{ error?: string }> {
  const user = await requireUser();

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

  const user = await db.user.findUnique({
    where: { email: email.data },
    select: { id: true, credential: { select: { id: true } } },
  });

  // Silent success — don't reveal whether an account exists.
  if (!user || !user.credential) return { success: true };

  await db.verificationToken.deleteMany({
    where: { userId: user.id, type: "PASSWORD_RESET" },
  });

  const token = generateToken();
  await db.verificationToken.create({
    data: {
      userId: user.id,
      token,
      type: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendPasswordResetEmail(email.data, token);
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

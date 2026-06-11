"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { isWaitlistAdmin, isWaitlistMode, verifyWaitlistFormToken } from "@/lib/waitlist";
import { isRateLimited } from "@/lib/rate-limit";

const SUBMISSIONS_PER_IP = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const emailSchema = z
  .string()
  .trim()
  .email("Invalid email address")
  .max(254, "Email must be at most 254 characters");

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function joinWaitlistAction(
  _prev: { error?: string; email?: string } | null,
  formData: FormData
): Promise<{ error?: string; email?: string }> {
  if (!isWaitlistMode()) {
    return { error: "The waitlist is not open." };
  }

  // Honeypot: the hidden "website" field is invisible to humans but filled by
  // form bots. Pretend success and store nothing, so the bot moves on.
  const honeypot = formData.get("website");
  if (typeof honeypot === "string" && honeypot.length > 0) {
    return { email: String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254) };
  }

  const ip = await clientIp();
  if (isRateLimited(`waitlist:${ip}`, SUBMISSIONS_PER_IP, RATE_WINDOW_MS)) {
    return { error: "Too many attempts. Please try again later." };
  }

  // Rejects forged tokens and submissions faster than a human can type.
  // A too-fast retry succeeds naturally: the token ages past the minimum.
  const token = formData.get("ft");
  if (typeof token !== "string" || !verifyWaitlistFormToken(token)) {
    return { error: "Something went wrong. Please try again." };
  }

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const email = parsed.data.toLowerCase();

  // Idempotent: re-submitting the same address is a no-op, not an error, so
  // users can safely retry and we never reveal whether an address was already
  // on the list.
  await db.waitlistEntry.upsert({
    where: { email },
    create: { email },
    update: {},
  });

  return { email };
}

// Toggles the manual "invited" bookkeeping on a waitlist entry. Marking sets
// invitedAt so the admin page moves the entry to the invited section; clicking
// again clears it (misclick undo). Operator-only.
export async function toggleWaitlistInvitedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!isWaitlistAdmin(user.email)) {
    throw new Error("Not authorized");
  }

  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) {
    throw new Error("Invalid waitlist entry id");
  }

  const entry = await db.waitlistEntry.findUnique({
    where: { id: id.data },
    select: { invitedAt: true },
  });
  if (!entry) {
    throw new Error("Waitlist entry not found");
  }

  await db.waitlistEntry.update({
    where: { id: id.data },
    data: { invitedAt: entry.invitedAt ? null : new Date() },
  });

  revalidatePath("/admin/waitlist");
}

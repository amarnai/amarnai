"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { sanitizeBridgePath } from "@/lib/bridge-redirect";

/**
 * Exchange a one-time bridge code from the extension for a web session, then
 * continue to the requested page.
 *
 * On success next-auth throws NEXT_REDIRECT, which Next.js turns into the
 * navigation. Every other failure (unknown, spent, or expired code, or an API
 * that cannot be reached) falls back to the sign-in page with the destination
 * preserved, so the user finishes where they were headed either way — the worst
 * case is exactly the behaviour they had before the bridge existed.
 */
export async function bridgeSignInAction(formData: FormData): Promise<void> {
  const code = (formData.get("code") as string | null) ?? "";
  const destination = sanitizeBridgePath(formData.get("next") as string | null);
  const signInUrl = `/sign-in?next=${encodeURIComponent(destination)}`;

  if (!code) redirect(signInUrl);

  try {
    await signIn("bridge", { code, redirectTo: destination });
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    redirect(signInUrl);
  }
}

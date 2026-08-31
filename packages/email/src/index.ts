import nodemailer from "nodemailer";
import { Resend } from "resend";
import { colors } from "@aziru/tokens";

/** Base URL of the web app, trailing slash stripped. Exported so other packages
 * (e.g. the worker building unsubscribe links) resolve it from one place. */
export function appUrl(): string {
  return (process.env["AUTH_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Escape user-controlled text before interpolating it into email HTML. Display
 * names and workspace names are attacker-influenced, so they must never be able
 * to inject markup (link spoofing, layout breakage) into an email body.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function from(): string {
  return process.env["EMAIL_FROM"] ?? "noreply@aziru.email";
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  headers?: Record<string, string>,
  // Stable key so an at-least-once caller (a retried worker job) that re-sends the
  // same email collapses at the provider instead of delivering twice. Sent as the
  // `Idempotency-Key` header by Resend; SMTP has no equivalent, so callers that need
  // exactly-once on self-host must also gate on a DB marker (see lifecycle-email).
  idempotencyKey?: string,
): Promise<void> {
  const resendApiKey = process.env["RESEND_API_KEY"];
  if (resendApiKey) {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send(
      {
        from: from(),
        to,
        subject,
        html,
        ...(headers ? { headers } : {}),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) throw new Error(`Resend error: ${error.message}`);
    return;
  }

  const port = Number(process.env["SMTP_PORT"] ?? 1025);
  const transport = nodemailer.createTransport({
    host: process.env["SMTP_HOST"] ?? "127.0.0.1",
    port,
    secure: process.env["SMTP_SECURE"] === "true" || port === 465,
    ...(process.env["SMTP_USER"]
      ? { auth: { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] ?? "" } }
      : {}),
  });
  await transport.sendMail({ from: from(), to, subject, html, ...(headers ? { headers } : {}) });
}

// ─── Shared layout ──────────────────────────────────────────────────────────
//
// Every Aziru email renders through `layout()` so the header, container, and
// footer markup live in one place (CLAUDE.md: do not duplicate styles). Colors
// come from the shared design tokens — no brand hex is hardcoded here.
// Email clients ignore <style>/external CSS, so all styling is inline.

interface LayoutOptions {
  /** Optional one-click unsubscribe URL. When set, a muted opt-out line is
   * appended to the footer. Only lifecycle (non-transactional) emails pass this. */
  unsubscribeUrl?: string;
}

/** A terracotta CTA button. Inline-styled for email-client compatibility. */
function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${colors.accent};color:${colors.surface};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${label}</a>`;
}

function layout(bodyHtml: string, opts: LayoutOptions = {}): string {
  const unsubscribe = opts.unsubscribeUrl
    ? `<p style="margin:12px 0 0;">You're receiving this because you have an Aziru account. <a href="${opts.unsubscribeUrl}" style="color:${colors.ink3};">Unsubscribe from these reminders</a>.</p>`
    : "";

  return `
  <div style="background:${colors.bg};padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:${colors.surface};border:1px solid ${colors.line};border-radius:12px;overflow:hidden;">
      <div style="padding:20px 28px;border-bottom:1px solid ${colors.line};">
        <span style="font-size:18px;font-weight:700;color:${colors.accent};">Aziru</span>
      </div>
      <div style="padding:28px;color:${colors.ink};font-size:15px;line-height:1.55;">
        ${bodyHtml}
      </div>
      <div style="padding:18px 28px;border-top:1px solid ${colors.line};color:${colors.ink3};font-size:12px;line-height:1.5;">
        <p style="margin:0;">Aziru — AI email triage.</p>
        ${unsubscribe}
      </div>
    </div>
  </div>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/api/auth/verify-email?token=${token}`;
  await sendEmail(
    to,
    "Verify your Aziru account",
    layout(`
      <p style="margin:0 0 12px;">Welcome to Aziru!</p>
      <p style="margin:0 0 20px;">Confirm your email address to finish setting up your account. This link expires in 24 hours.</p>
      <p style="margin:0 0 20px;">${button(link, "Verify email address")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">If you didn't create an account, you can ignore this email.</p>
    `)
  );
}

// Sent when someone tries to register an email that already has a verified
// password account. Registration returns the same neutral response for every
// account state, so this email — which only the real mailbox owner receives — is
// where the "you already have an account" guidance lives, without the endpoint
// leaking that the account exists.
export async function sendAccountExistsEmail(to: string): Promise<void> {
  const signIn = `${appUrl()}/sign-in`;
  const forgot = `${appUrl()}/forgot-password`;
  await sendEmail(
    to,
    "You already have an Aziru account",
    layout(`
      <p style="margin:0 0 12px;">Someone (probably you) just tried to sign up for Aziru with this email address, but you already have an account.</p>
      <p style="margin:0 0 20px;">Sign in to pick up where you left off. If you've forgotten your password, you can reset it.</p>
      <p style="margin:0 0 20px;">${button(signIn, "Sign in")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">Forgot your password? <a href="${forgot}" style="color:${colors.ink3};">Reset it here</a>. If this wasn't you, no action is needed — no changes were made to your account.</p>
    `)
  );
}

// Sent when someone tries to register an email that already has a verified
// Google (password-less) account. Same rationale as sendAccountExistsEmail: the
// register response stays neutral, and the guidance reaches only the real owner.
export async function sendGoogleAccountEmail(to: string): Promise<void> {
  const signIn = `${appUrl()}/sign-in`;
  await sendEmail(
    to,
    "You already have an Aziru account",
    layout(`
      <p style="margin:0 0 12px;">Someone (probably you) just tried to sign up for Aziru with this email address, but you already have an account that signs in with Google.</p>
      <p style="margin:0 0 20px;">Use <strong>Sign in with Google</strong> to get back in — there's no password to set.</p>
      <p style="margin:0 0 20px;">${button(signIn, "Go to sign in")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">If this wasn't you, no action is needed — no changes were made to your account.</p>
    `)
  );
}

// Microsoft counterpart of sendGoogleAccountEmail, for an account that signs in
// with Microsoft and holds no password.
export async function sendMicrosoftAccountEmail(to: string): Promise<void> {
  const signIn = `${appUrl()}/sign-in`;
  await sendEmail(
    to,
    "You already have an Aziru account",
    layout(`
      <p style="margin:0 0 12px;">Someone (probably you) just tried to sign up for Aziru with this email address, but you already have an account that signs in with Microsoft.</p>
      <p style="margin:0 0 20px;">Use <strong>Sign in with Microsoft</strong> to get back in — there's no password to set.</p>
      <p style="margin:0 0 20px;">${button(signIn, "Go to sign in")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">If this wasn't you, no action is needed — no changes were made to your account.</p>
    `)
  );
}

export async function sendWorkspaceInvitationEmail(
  to: string,
  inviterName: string,
  workspaceName: string,
  token: string
): Promise<void> {
  const link = `${appUrl()}/api/workspace-invite/accept?token=${token}`;
  await sendEmail(
    to,
    `You've been invited to join ${workspaceName} on Aziru`,
    layout(`
      <p style="margin:0 0 12px;">${esc(inviterName)} has invited you to join the <strong>${esc(workspaceName)}</strong> workspace on Aziru.</p>
      <p style="margin:0 0 20px;">Accept the invitation to get started. This link expires in 48 hours.</p>
      <p style="margin:0 0 20px;">${button(link, "Accept invitation")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">If you weren't expecting this invitation, you can ignore this email.</p>
    `)
  );
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmail(
    to,
    "Reset your Aziru password",
    layout(`
      <p style="margin:0 0 12px;">You requested a password reset for your Aziru account.</p>
      <p style="margin:0 0 20px;">Set a new password using the button below. This link expires in 1 hour.</p>
      <p style="margin:0 0 20px;">${button(link, "Reset password")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">If you didn't request this, you can ignore this email.</p>
    `)
  );
}

export async function sendWelcomeEmail(to: string, name?: string | null): Promise<void> {
  const greeting = name?.trim() ? `Welcome, ${esc(name.trim())}!` : "Welcome to Aziru!";
  const link = `${appUrl()}/emails`;
  await sendEmail(
    to,
    "Welcome to Aziru",
    layout(`
      <p style="margin:0 0 12px;font-size:17px;font-weight:600;">${greeting}</p>
      <p style="margin:0 0 12px;">Your email is verified and your account is ready. Aziru sorts and triages your inbox with AI so the threads that need you rise to the top.</p>
      <p style="margin:0 0 20px;">Connect your Gmail to start triaging, then let Aziru do the sorting.</p>
      <p style="margin:0 0 20px;">${button(link, "Open Aziru")}</p>
      <p style="margin:0;color:${colors.ink3};font-size:13px;">Drafts always require your approval — Aziru never sends email on your behalf.</p>
    `)
  );
}

// ─── Lifecycle reminder ─────────────────────────────────────────────────────

/** One workspace's actionable summary, used to render the weekly digest. */
export interface LifecycleWorkspaceSummary {
  workspaceName: string;
  needsReview: number;
  pending: number;
}

export interface LifecycleReminderPayload {
  /** The user's display name, when available. */
  name?: string | null;
  /** Per-workspace breakdown. Only workspaces with something to report. */
  workspaces: LifecycleWorkspaceSummary[];
  /** Signed one-click unsubscribe URL for this user. */
  unsubscribeUrl: string;
}

export async function sendLifecycleReminderEmail(
  to: string,
  payload: LifecycleReminderPayload,
  // Idempotency key for the send. The worker passes a stable per-job key so a retry
  // after a successful-but-uncommitted send collapses at the provider (see
  // lifecycle-email.ts, which also gates on a DB marker for the SMTP/self-host case).
  opts?: { idempotencyKey?: string },
): Promise<void> {
  const link = `${appUrl()}/emails`;
  const totalNeedsReview = payload.workspaces.reduce((n, w) => n + w.needsReview, 0);
  const greeting = payload.name?.trim() ? `Hi ${esc(payload.name.trim())},` : "Hi there,";

  // Per-workspace rows. When the user has a single workspace we omit the name to
  // keep the digest terse.
  const showNames = payload.workspaces.length > 1;
  const rows = payload.workspaces
    .map((w) => {
      const label = showNames
        ? `<strong>${esc(w.workspaceName)}</strong>: `
        : "";
      const parts: string[] = [];
      if (w.needsReview > 0) parts.push(`${w.needsReview} need${w.needsReview === 1 ? "s" : ""} review`);
      if (w.pending > 0) parts.push(`${w.pending} pending`);
      return `<li style="margin:0 0 6px;">${label}${parts.join(", ")}</li>`;
    })
    .join("");

  const headline =
    totalNeedsReview > 0
      ? `You have ${totalNeedsReview} thread${totalNeedsReview === 1 ? "" : "s"} waiting for your review.`
      : "Here's where your inbox stands.";

  await sendEmail(
    to,
    "Your Aziru inbox needs a look",
    layout(
      `
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 16px;">${headline}</p>
      <ul style="margin:0 0 20px;padding-left:20px;color:${colors.ink2};">${rows}</ul>
      <p style="margin:0 0 20px;">${button(link, "Review in Aziru")}</p>
    `,
      { unsubscribeUrl: payload.unsubscribeUrl }
    ),
    {
      // RFC 8058 one-click unsubscribe. Improves deliverability and gives Gmail a
      // native unsubscribe affordance.
      "List-Unsubscribe": `<${payload.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    opts?.idempotencyKey
  );
}

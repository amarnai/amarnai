import nodemailer from "nodemailer";
import { Resend } from "resend";

function appUrl(): string {
  return (process.env["AUTH_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
}

function from(): string {
  return process.env["EMAIL_FROM"] ?? "noreply@amarnai.com";
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendApiKey = process.env["RESEND_API_KEY"];
  if (resendApiKey) {
    const resend = new Resend(resendApiKey);
    const { error } = await resend.emails.send({ from: from(), to, subject, html });
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
  await transport.sendMail({ from: from(), to, subject, html });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/api/auth/verify-email?token=${token}`;
  await sendEmail(
    to,
    "Verify your Amarnai account",
    `
      <p>Welcome to Amarnai!</p>
      <p>Click the link below to verify your email address. The link expires in 24 hours.</p>
      <p><a href="${link}">Verify email address</a></p>
      <p style="color:#888;font-size:12px;">If you didn't create an account, you can ignore this email.</p>
    `
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
    `You've been invited to join ${workspaceName} on Amarnai`,
    `
      <p>${inviterName} has invited you to join the <strong>${workspaceName}</strong> workspace on Amarnai.</p>
      <p>Click the link below to accept the invitation. The link expires in 48 hours.</p>
      <p><a href="${link}">Accept invitation</a></p>
      <p style="color:#888;font-size:12px;">If you weren't expecting this invitation, you can ignore this email.</p>
    `
  );
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmail(
    to,
    "Reset your Amarnai password",
    `
      <p>You requested a password reset for your Amarnai account.</p>
      <p>Click the link below to set a new password. The link expires in 1 hour.</p>
      <p><a href="${link}">Reset password</a></p>
      <p style="color:#888;font-size:12px;">If you didn't request this, you can ignore this email.</p>
    `
  );
}

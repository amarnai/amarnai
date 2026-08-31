import { vi, describe, it, expect, beforeEach } from "vitest";

// No RESEND_API_KEY in the test env, so sendEmail() takes the nodemailer path.
// We mock nodemailer to capture exactly what would be sent.
const sendMail = vi.fn(async (_opts: Record<string, unknown>) => ({}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import {
  sendWelcomeEmail,
  sendLifecycleReminderEmail,
  sendAccountExistsEmail,
  sendGoogleAccountEmail,
} from "./index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registration notice emails", () => {
  it("sendAccountExistsEmail points the real owner at sign-in and reset, with no unsubscribe", async () => {
    await sendAccountExistsEmail("owner@x.com");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.to).toBe("owner@x.com");
    expect(mail.subject).toBe("You already have an Aziru account");
    expect(mail.html).toContain("/sign-in");
    expect(mail.html).toContain("/forgot-password");
    expect(mail.html).not.toContain("Unsubscribe");
  });

  it("sendGoogleAccountEmail points the owner at Google sign-in", async () => {
    await sendGoogleAccountEmail("owner@x.com");

    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.subject).toBe("You already have an Aziru account");
    expect(mail.html).toContain("/sign-in");
    expect(mail.html).toContain("Google");
  });
});

describe("sendWelcomeEmail", () => {
  it("greets the user by name and links into the app, with no unsubscribe", async () => {
    await sendWelcomeEmail("new@user.com", "Ada");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.to).toBe("new@user.com");
    expect(mail.subject).toBe("Welcome to Aziru");
    expect(mail.html).toContain("Welcome, Ada!");
    expect(mail.html).toContain("/emails");
    // Transactional one-shot — never carries an unsubscribe affordance.
    expect(mail.html).not.toContain("Unsubscribe");
    expect(mail.headers).toBeUndefined();
  });

  it("falls back to a generic greeting without a name", async () => {
    await sendWelcomeEmail("new@user.com");
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.html).toContain("Welcome to Aziru!");
  });

  it("escapes HTML in the display name (no markup injection)", async () => {
    await sendWelcomeEmail("new@user.com", '<img src=x onerror=alert(1)>');
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });
});

describe("sendLifecycleReminderEmail", () => {
  const unsubscribeUrl = "https://app.test/api/email/unsubscribe?u=user-1&sig=abc";

  it("renders the digest and includes List-Unsubscribe headers", async () => {
    await sendLifecycleReminderEmail("user@x.com", {
      name: "Ada",
      workspaces: [{ workspaceName: "Acme", needsReview: 3, pending: 5 }],
      unsubscribeUrl,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.to).toBe("user@x.com");
    expect(mail.html).toContain("3 threads waiting");
    expect(mail.html).toContain("3 need");
    expect(mail.html).toContain("5 pending");
    expect(mail.html).toContain(unsubscribeUrl);

    const headers = mail.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toBe(`<${unsubscribeUrl}>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("escapes HTML in workspace names", async () => {
    await sendLifecycleReminderEmail("user@x.com", {
      name: null,
      workspaces: [
        { workspaceName: "<script>alert(1)</script>", needsReview: 1, pending: 0 },
        { workspaceName: "Other", needsReview: 1, pending: 0 },
      ],
      unsubscribeUrl,
    });
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("names each workspace when the user has more than one", async () => {
    await sendLifecycleReminderEmail("user@x.com", {
      name: null,
      workspaces: [
        { workspaceName: "Acme", needsReview: 1, pending: 0 },
        { workspaceName: "Beta", needsReview: 0, pending: 2 },
      ],
      unsubscribeUrl,
    });
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.html).toContain("Acme");
    expect(mail.html).toContain("Beta");
  });
});

import { z } from "zod";

// Shared minimum so clients can validate before submitting without re-deriving
// the rule from the schema. 12 characters aligns with NIST SP 800-63B and OWASP
// ASVS guidance for user-chosen passwords.
export const PASSWORD_MIN_LENGTH = 12;

// The single password field used by every password entry point: the web and API
// register flows, the password-reset flow, and the mobile sign-up screen. The
// 12–72 bound is the minimum above and bcrypt's 72-byte input limit on top.
// Defined once so the rule can never drift between flows.
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(72, "Password must be at most 72 characters");

// Registration is email-first: the sign-up form collects only an email, and the
// password is set later at the verify step by whoever proves they own the
// mailbox. This keeps the register response non-enumerating (no session or
// token is ever handed back, so it cannot differ by account state) and makes an
// account pre-hijack structurally impossible (no password is ever stored before
// mailbox ownership is proven). Shared by the web register action and the API
// /auth/register endpoint so validation lives in exactly one place.
export const RegisterEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
});
export type RegisterEmailInput = z.infer<typeof RegisterEmailSchema>;

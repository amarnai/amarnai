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

// Credentials accepted when registering a password-based account. Shared by the
// web register action, the API /auth/register endpoint, and the mobile sign-up
// screen so validation lives in exactly one place.
export const RegisterCredentialsSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: PasswordSchema,
});
export type RegisterCredentialsInput = z.infer<typeof RegisterCredentialsSchema>;

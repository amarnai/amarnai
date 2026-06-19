import { z } from "zod";

// Credentials accepted when registering a password-based account. The 8–72
// character bound matches bcrypt's 72-byte input limit on the upper end and a
// sensible minimum on the lower. Shared by the web register action, the API
// /auth/register endpoint, and the mobile sign-up screen so validation lives in
// exactly one place.
export const RegisterCredentialsSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});
export type RegisterCredentialsInput = z.infer<typeof RegisterCredentialsSchema>;

// Shared minimum so clients can validate before submitting without re-deriving
// the rule from the schema.
export const PASSWORD_MIN_LENGTH = 8;

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isEmailVerified: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    isEmailVerified?: boolean;
    // Monotonic session-invalidation counter stamped at issue time; a token whose
    // epoch is below the account's current sessionEpoch is treated as signed out.
    sessionEpoch?: number;
  }
}

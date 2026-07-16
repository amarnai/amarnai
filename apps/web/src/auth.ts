import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials, provisionGoogleUser } from "@amarnai/auth";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { db } from "@amarnai/db";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import { resolveSessionToken } from "@/lib/session-jwt";
import { getRequestLocale } from "@/lib/i18n-server";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  providers: [
    Google({
      clientId: process.env["AUTH_GOOGLE_ID"] ?? "",
      clientSecret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
      authorization: {
        params: {
          scope: `openid email profile ${GMAIL_READONLY_SCOPE}`,
          access_type: "offline",
          prompt: "select_account",
        },
      },
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email as string;
        const password = credentials.password as string;

        // Shared credential check (bcrypt + DB) — see @amarnai/auth.
        const userId = await verifyCredentials(email, password);
        if (!userId) return null;

        const user = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, imageUrl: true },
        });
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.imageUrl };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      // Credentials users are created in registerAction and their emailVerified
      // is set only after clicking the verification link — skip the upsert here.
      if (account?.provider === "credentials") return true;

      // Google OAuth — Google has already verified the email address. Shared
      // provisioning upserts the user and, when tokens are present (first grant
      // or re-grant), creates the default workspace + Gmail connection.
      const isGoogle = account?.provider === "google";
      const { userId, workspaceId, isNew, gmailConnected } = await provisionGoogleUser({
        email: user.email,
        name: user.name ?? null,
        imageUrl: user.image ?? null,
        gmailAccessToken: isGoogle ? account?.access_token ?? null : null,
        gmailRefreshToken: isGoogle ? account?.refresh_token ?? null : null,
        // Seed the default workspace language from the browser locale (resolved by
        // proxy.ts, cookie-first then Accept-Language). Without this the workspace
        // hard-defaults to "en" while the UI auto-detects the browser, so a French
        // user gets a French UI but English AI-generated taxonomy. Mirrors the API
        // sign-up path and createWorkspaceAction. Applied only on create, so a
        // returning user's chosen language is never overridden.
        locale: await getRequestLocale(),
      });

      // First-time Google sign-up: kick off an immediate inbox sync and register
      // the Gmail push watch. Fire-and-forget — the polling scheduler and the
      // worker's daily watch renewal are the fallbacks.
      if (isGoogle && gmailConnected && isNew && workspaceId) {
        triggerPostConnectHooks("auth", workspaceId, userId);
      }

      return true;
    },

    async jwt({ token, user, trigger }) {
      // Resolve on EVERY evaluation so a session-epoch bump invalidates the token
      // immediately (see resolveSessionToken). The sign-in mint (user present, or
      // trigger "signIn") stamps the epoch; every other call enforces it.
      const isInitialMint = Boolean(user) || trigger === "signIn";
      return resolveSessionToken(token, isInitialMint);
    },

    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      session.user.isEmailVerified = token.isEmailVerified === true;
      return session;
    },
  },
});

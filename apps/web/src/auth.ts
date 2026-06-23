import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials, provisionGoogleUser } from "@amarnai/auth";
import { GMAIL_READONLY_SCOPE } from "@amarnai/gmail";
import { db } from "@amarnai/db";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";

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
      });

      // First-time Google sign-up: kick off an immediate inbox sync and register
      // the Gmail push watch. Fire-and-forget — the polling scheduler and the
      // worker's daily watch renewal are the fallbacks.
      if (isGoogle && gmailConnected && isNew && workspaceId) {
        triggerPostConnectHooks("auth", workspaceId, userId);
      }

      return true;
    },

    async jwt({ token, trigger }) {
      const needsLookup = !token.userId || trigger === "signIn" || trigger === "update";
      if (needsLookup && token.email) {
        const dbUser = await db.user.findUnique({
          where: { email: token.email },
          select: { id: true, name: true, emailVerified: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.name = dbUser.name;
          token.isEmailVerified = dbUser.emailVerified !== null;
        } else {
          delete token.userId;
          delete token.isEmailVerified;
        }
      }
      return token;
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

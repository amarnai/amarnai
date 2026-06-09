import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@amarnai/db";
import { getOrCreateDefaultWorkspace } from "@/lib/workspace";
import { fetchGmailProfile } from "@/lib/gmail-oauth";
import { encrypt } from "@/lib/encryption";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

        const user = await db.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, imageUrl: true, emailVerified: true },
        });
        if (!user) return null;

        const cred = await db.userCredential.findUnique({ where: { userId: user.id } });
        if (!cred) return null; // Google-auth user — no password set

        const valid = await bcrypt.compare(password, cred.passwordHash);
        if (!valid) return null;

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

      // Google OAuth — Google has already verified the email address.
      const isNew = !(await db.user.findUnique({
        where: { email: user.email },
        select: { id: true },
      }));

      const dbUser = await db.user.upsert({
        where: { email: user.email },
        update: {
          ...(user.name != null ? { name: user.name } : {}),
          ...(user.image != null ? { imageUrl: user.image } : {}),
          emailVerified: new Date(),
        },
        create: {
          email: user.email,
          name: user.name ?? null,
          imageUrl: user.image ?? null,
          emailVerified: new Date(),
        },
        select: { id: true },
      });

      // One-step workspace + Gmail connection setup for Google sign-ups.
      // account.refresh_token is only present on first authorization (or re-grant),
      // so this block naturally targets new users without an explicit isNew check.
      if (account?.provider === "google" && account.refresh_token && account.access_token) {
        try {
          const workspace = await getOrCreateDefaultWorkspace(dbUser.id);
          const profile = await fetchGmailProfile(account.access_token as string);
          const encryptedRefreshToken = encrypt(account.refresh_token as string);
          await db.gmailConnection.upsert({
            where: { workspaceId: workspace.id },
            create: {
              workspaceId: workspace.id,
              gmailAddress: profile.emailAddress,
              encryptedRefreshToken,
              grantedScopes: [GMAIL_READONLY_SCOPE],
              status: "ACTIVE",
              lastVerifiedAt: new Date(),
            },
            update: {
              gmailAddress: profile.emailAddress,
              encryptedRefreshToken,
              grantedScopes: [GMAIL_READONLY_SCOPE],
              status: "ACTIVE",
              lastVerifiedAt: new Date(),
            },
          });

          if (isNew) {
            const apiBase = process.env["API_URL"] ?? "http://localhost:3001";
            const internalSecret = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";
            const authHeader = { Authorization: `Bearer ${internalSecret}`, "X-User-Id": dbUser.id };

            fetch(`${apiBase}/workspaces/${workspace.id}/trigger-sync`, {
              method: "POST",
              headers: authHeader,
            }).catch(
              (err) =>
                console.error("[auth] trigger_sync:", err instanceof Error ? err.message : err)
            );

            fetch(`${apiBase}/workspaces/${workspace.id}/register-gmail-watch`, {
              method: "POST",
              headers: authHeader,
            }).catch(
              (err) =>
                console.error("[auth] register_watch:", err instanceof Error ? err.message : err)
            );
          }
        } catch (err) {
          console.error(
            "[auth] google_workspace_setup:",
            err instanceof Error ? err.message : err
          );
          // Non-fatal: sign-in succeeds; user can connect Gmail manually from settings.
        }
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

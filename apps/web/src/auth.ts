import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@amarnai/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env["AUTH_GOOGLE_ID"] ?? "",
      clientSecret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
      authorization: {
        params: {
          scope: "openid email profile",
          prompt: "select_account",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      await db.user.upsert({
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
      });
      return true;
    },
    async jwt({ token, trigger }) {
      const needsLookup = !token.userId || trigger === "signIn" || trigger === "update";
      if (needsLookup && token.email) {
        const dbUser = await db.user.findUnique({
          where: { email: token.email },
          select: { id: true },
        });
        if (dbUser) token.userId = dbUser.id;
        else delete token.userId;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});

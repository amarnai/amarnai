import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { verifyCredentials, provisionGoogleUser, provisionMicrosoftUser } from "@amarnai/auth";
import { GMAIL_READONLY_SCOPE, GMAIL_MODIFY_SCOPE, parseGrantedScopes } from "@amarnai/gmail";
import {
  OUTLOOK_SCOPES,
  OUTLOOK_MAIL_READWRITE_SCOPE,
  OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE,
  parseGrantedScopes as parseOutlookScopes,
} from "@amarnai/outlook";
import { db } from "@amarnai/db";
import { triggerPostConnectHooks } from "@/lib/post-connect-hooks";
import { resolveSessionToken } from "@/lib/session-jwt";
import { redeemBridgeCode } from "@/lib/bridge-code";
import { getRequestLocale } from "@/lib/i18n-server";
import { isLabelWritebackEnabled } from "@/lib/writeback-flag";
import { isOutlookConfigured, fetchOutlookProfile } from "@/lib/outlook-oauth";

// When the writeback feature is enabled, mail authorization (including
// gmail.modify) is gathered upfront at sign-in — writeback defaults on, and
// upcoming in-Gmail features (summaries, draft replies) share the same grant.
// Users can still uncheck the modify permission on Google's granular-consent
// screen; the connection then proceeds read-only and writeback stays inert.
const GMAIL_SIGNIN_SCOPES = isLabelWritebackEnabled()
  ? `${GMAIL_READONLY_SCOPE} ${GMAIL_MODIFY_SCOPE}`
  : GMAIL_READONLY_SCOPE;

// Microsoft counterpart, same upfront-grant policy. Note this is the UNION of
// OUTLOOK_SCOPES and the two write scopes, not OUTLOOK_WRITEBACK_SCOPES: that
// constant drops Mail.Read, and Microsoft refresh tokens are scope-bound, so a
// sign-in that asked only for the writeback set would leave the connection
// unable to fall back to read-only if the user declines a write permission.
const MICROSOFT_SIGNIN_SCOPES = isLabelWritebackEnabled()
  ? `${OUTLOOK_SCOPES} ${OUTLOOK_MAIL_READWRITE_SCOPE} ${OUTLOOK_MAILBOX_SETTINGS_RW_SCOPE}`
  : OUTLOOK_SCOPES;

// One Azure app registration serves the web sign-in, the web connect callback,
// and the extension — so the credentials come from MS_GRAPH_* rather than
// NextAuth's AUTH_MICROSOFT_ENTRA_ID_* convention. That is what lets the worker
// refresh a sign-in-issued Outlook token with the secret it already holds.
const MICROSOFT_TENANT = process.env["MS_GRAPH_TENANT"]?.trim() || "common";

const providers: Provider[] = [
  Google({
    clientId: process.env["AUTH_GOOGLE_ID"] ?? "",
    clientSecret: process.env["AUTH_GOOGLE_SECRET"] ?? "",
    authorization: {
      params: {
        scope: `openid email profile ${GMAIL_SIGNIN_SCOPES}`,
        access_type: "offline",
        prompt: "select_account",
      },
    },
  }),
];

// Only offered when the Microsoft credential pair is configured; otherwise the
// provider would render a button whose flow cannot complete.
if (isOutlookConfigured()) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env["MS_GRAPH_CLIENT_ID"] ?? "",
      clientSecret: process.env["MS_GRAPH_CLIENT_SECRET"] ?? "",
      issuer: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/v2.0`,
      authorization: {
        params: {
          scope: `openid profile email ${MICROSOFT_SIGNIN_SCOPES}`,
          prompt: "select_account",
        },
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  providers: [
    ...providers,
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
    // Carries an already-authenticated extension user into a web session. The
    // panel mints a one-time code against the API and hands it to /auth/bridge;
    // this exchanges it for an identity server-side. Redemption goes through the
    // API (not a direct DB read) because the API owns the code's single-use
    // claim, and it is gated on the internal secret so only this server can
    // perform the exchange.
    Credentials({
      id: "bridge",
      credentials: { code: {} },
      async authorize(credentials) {
        const code = typeof credentials?.code === "string" ? credentials.code : "";
        if (!code) return null;

        const redeemed = await redeemBridgeCode(code);
        if (!redeemed) return null;

        // Read the profile locally rather than trusting the redeem payload for
        // anything beyond identity, so the session carries the same fields a
        // password sign-in would.
        const user = await db.user.findUnique({
          where: { id: redeemed.userId },
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
    // Exhaustive on provider: every branch returns, and an unrecognised provider
    // is refused rather than falling through into Google provisioning.
    async signIn({ user, account }) {
      // Credentials users are created in registerAction and their emailVerified
      // is set only after clicking the verification link — skip the upsert here.
      // "bridge" is the same story: the account already exists (the extension is
      // signed in as it), so there is nothing to provision.
      if (account?.provider === "credentials" || account?.provider === "bridge") return true;

      if (account?.provider === "microsoft-entra-id") {
        // Identity comes from Graph /me, never from the id_token email claim: on
        // the /common authority that claim is not tenant-verified (the nOAuth
        // class of account takeover), while /me is bound to the token we hold.
        // Without an access token there is nothing authoritative to trust, so the
        // sign-in is refused rather than provisioned on a claimed address.
        const accessToken = account.access_token;
        if (!accessToken) return false;

        let email: string;
        let displayName: string | null;
        try {
          ({ emailAddress: email, displayName } = await fetchOutlookProfile(accessToken));
        } catch (err) {
          console.error(
            "[auth] microsoft_profile:",
            err instanceof Error ? err.message : err,
          );
          return false;
        }

        // Persist what Microsoft ACTUALLY granted. A grant missing Mail.Read
        // provisions the account WITHOUT tokens: sign-in still succeeds and the
        // inbox can be connected from settings, matching how a Google sign-in that
        // declines Gmail access is handled.
        const { scopes, hasReadonly } = account.scope
          ? parseOutlookScopes(account.scope)
          : { scopes: [] as string[], hasReadonly: false };

        const { userId, workspaceId, isNew, outlookConnected } = await provisionMicrosoftUser({
          email,
          name: displayName ?? user.name ?? null,
          outlookAccessToken: hasReadonly ? accessToken : null,
          outlookRefreshToken: hasReadonly ? account.refresh_token ?? null : null,
          ...(scopes.length > 0 ? { grantedScopes: scopes } : {}),
          locale: await getRequestLocale(),
        });

        if (outlookConnected && isNew && workspaceId) {
          triggerPostConnectHooks("auth", workspaceId, userId, "outlook");
        }

        return true;
      }

      if (account?.provider === "google") {
        if (!user.email) return false;

        // Google OAuth — Google has already verified the email address. Shared
        // provisioning upserts the user and, when tokens are present (first grant
        // or re-grant), creates the default workspace + Gmail connection.
        //
        // Persist what Google ACTUALLY granted (the user can uncheck individual
        // permissions on the granular-consent screen). Writeback and other
        // scope-gated features key off this stored list; without it a sign-in
        // grant of gmail.modify would be recorded as readonly-only.
        const grantedScopes = account.scope
          ? parseGrantedScopes(account.scope).scopes
          : undefined;
        const { userId, workspaceId, isNew, gmailConnected } = await provisionGoogleUser({
          email: user.email,
          name: user.name ?? null,
          imageUrl: user.image ?? null,
          gmailAccessToken: account.access_token ?? null,
          gmailRefreshToken: account.refresh_token ?? null,
          ...(grantedScopes ? { grantedScopes } : {}),
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
        if (gmailConnected && isNew && workspaceId) {
          triggerPostConnectHooks("auth", workspaceId, userId);
        }

        return true;
      }

      return false;
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

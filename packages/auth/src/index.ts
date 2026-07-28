export { issueAccessToken, verifyAccessToken, type VerifiedAccessToken } from "./jwt.js";
export {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  deleteExpiredRefreshTokens,
} from "./refresh-token.js";
export type { IssuedRefreshToken } from "./refresh-token.js";
export { verifyCredentials, checkUserPassword } from "./credentials.js";
export type { PasswordCheck } from "./credentials.js";
export { registerEmail, rotateVerificationToken } from "./register.js";
export type { RegisterEmailInput, RegisterEmailResult } from "./register.js";
export {
  createPasswordResetToken,
  issuePasswordResetToken,
  applyPasswordReset,
} from "./password-reset.js";
export { StaleWhileErrorCache } from "./session-account-cache.js";
export type { CacheOutcome } from "./session-account-cache.js";
export { getOrCreateDefaultWorkspace } from "./workspace.js";
export { provisionGoogleUser, provisionMicrosoftUser } from "./provision.js";
export type {
  FederatedProvider,
  ProvisionGoogleUserInput,
  ProvisionGoogleUserResult,
  ProvisionMicrosoftUserInput,
  ProvisionMicrosoftUserResult,
} from "./provision.js";
export { storeGmailConnection } from "./gmail-connection.js";
export type { StoreGmailConnectionInput } from "./gmail-connection.js";
export { storeOutlookConnection } from "./outlook-connection.js";
export type { StoreOutlookConnectionInput } from "./outlook-connection.js";
export { ProviderMismatchError, assertNoProviderConflict } from "./connection-guard.js";
export type { ConnectionProvider } from "./connection-guard.js";
export { upsertEmailConnection } from "./upsert-connection.js";
export type { UpsertEmailConnectionInput } from "./upsert-connection.js";
// signUnsubscribeToken / verifyUnsubscribeToken use node:crypto and are
// deliberately NOT re-exported here: this barrel is reachable from the web
// Edge middleware (via @/auth), and node:crypto breaks the Edge bundle. Import
// them from "@amarnai/auth/unsubscribe-token" instead.

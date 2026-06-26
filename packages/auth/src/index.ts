export { issueAccessToken, verifyAccessToken } from "./jwt.js";
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
export { registerWithPassword, rotateVerificationToken } from "./register.js";
export type { RegisterWithPasswordInput, RegisterWithPasswordResult } from "./register.js";
export { createPasswordResetToken } from "./password-reset.js";
export { getOrCreateDefaultWorkspace } from "./workspace.js";
export { provisionGoogleUser } from "./provision.js";
export type { ProvisionGoogleUserInput, ProvisionGoogleUserResult } from "./provision.js";
export { storeGmailConnection } from "./gmail-connection.js";
export type { StoreGmailConnectionInput } from "./gmail-connection.js";
// signUnsubscribeToken / verifyUnsubscribeToken use node:crypto and are
// deliberately NOT re-exported here: this barrel is reachable from the web
// Edge middleware (via @/auth), and node:crypto breaks the Edge bundle. Import
// them from "@amarnai/auth/unsubscribe-token" instead.

export { db } from "./client.js";
export { ensureInboxTaxonomy } from "./inbox.js";
export { resetWorkspaceData, deleteWorkspaceCascade, deleteUserCascade, createFreeWorkspace, eraseEmailAccountData, eraseStaleEmailAccounts, FreeWorkspaceLimitError } from "./workspace-ops.js";
export {
  getThreadSortUsage,
  type ThreadSortUsage,
} from "./thread-sort-usage.js";
export { eligibleThreadWhere } from "./eligible-threads.js";
export { messageSetSignature } from "./message-set-signature.js";
export { deleteStaleUnverifiedUsers } from "./stale-users.js";
export { decayStaleReviews, REVIEW_DECAY_TTL_MS } from "./review-decay.js";
export { buildInboxProfile, buildSenderSignal } from "./inbox-profile.js";
export {
  createNotification,
  type CreateNotificationInput,
  createNotificationsForWorkspaceMembers,
  type CreateWorkspaceNotificationsInput,
  deleteThreadAssignedNotifications,
  type DeleteThreadAssignedNotificationsInput,
  deleteCommentMentionNotifications,
  type DeleteCommentMentionNotificationsInput,
  maybeCreateExtensionNudge,
  type MaybeCreateExtensionNudgeInput,
  deleteExtensionNudgeNotifications,
  maybeCreateQuotaBlockedNotifications,
  type MaybeCreateQuotaBlockedNotificationsInput,
  deleteQuotaBlockedNotifications,
  deleteGmailDisconnectedNotifications,
} from "./notifications.js";
export { markGmailConnectionAuthFailed } from "./gmail-connection-status.js";
export {
  getInboxPlanCeiling,
  getInboxBackfillCeiling,
  type InboxPlanCeiling,
} from "./inbox-entitlement.js";
export {
  trialEmailKeyHash,
  hasTrialClaim,
  hasConsumedTrial,
  claimTrial,
  ensureTrialClaimForEmail,
  type TrialClaimResult,
} from "./trial-claims.js";
export {
  MeterKind,
  meterWindowStart,
  inboxKeyFor,
  getMeterUsed,
  getBackfillGraceUsed,
  recordMeterUsage,
  claimIdempotencyToken,
  releaseIdempotencyToken,
  pruneIdempotencyMarkers,
  IDEMPOTENCY_MARKER_RETENTION_MS,
  resolveInboxQuota,
} from "./usage-meter.js";
export {
  threadSortDedupToken,
  backfillChunkDedupToken,
  taxonomyGenDedupToken,
  lifecycleSendDedupToken,
} from "./idempotency-tokens.js";
export {
  ensureBackfillGrant,
  resolveBackfillBudget,
  GRACE_ROLLING_WINDOW_MS,
  type InboxQuota,
  type BackfillBudget,
} from "./usage-meter.js";
export { Prisma, PrismaClient, WorkspacePlan, BillingCycle } from "@prisma/client";

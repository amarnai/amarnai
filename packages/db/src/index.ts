export { db } from "./client.js";
export { ensureInboxTaxonomy } from "./inbox.js";
export { resetWorkspaceData, deleteWorkspaceCascade, deleteUserCascade, createFreeWorkspace, eraseEmailAccountData, eraseStaleEmailAccounts, FreeWorkspaceLimitError } from "./workspace-ops.js";
export {
  countRecurringThreadSorts,
  getThreadSortUsage,
  type ThreadSortUsage,
} from "./thread-sort-usage.js";
export { eligibleThreadWhere } from "./eligible-threads.js";
export { buildInboxProfile, buildSenderSignal } from "./inbox-profile.js";
export {
  createNotification,
  type CreateNotificationInput,
  createNotificationsForWorkspaceMembers,
  type CreateWorkspaceNotificationsInput,
  deleteThreadAssignedNotifications,
  type DeleteThreadAssignedNotificationsInput,
  maybeCreateExtensionNudge,
  type MaybeCreateExtensionNudgeInput,
  deleteExtensionNudgeNotifications,
  maybeCreateQuotaBlockedNotifications,
  type MaybeCreateQuotaBlockedNotificationsInput,
  deleteQuotaBlockedNotifications,
  deleteGmailDisconnectedNotifications,
} from "./notifications.js";
export { markGmailConnectionAuthFailed } from "./gmail-connection-status.js";
export { getInboxPlanCeiling, type InboxPlanCeiling } from "./inbox-entitlement.js";
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
  resolveInboxQuota,
  ensureBackfillGrant,
  resolveBackfillBudget,
  type InboxQuota,
  type BackfillBudget,
} from "./usage-meter.js";
export { Prisma, PrismaClient, WorkspacePlan, BillingCycle } from "@prisma/client";

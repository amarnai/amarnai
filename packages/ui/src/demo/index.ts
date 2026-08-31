/**
 * Shared product demos: the animated sorting feed and the interactive plan
 * canvas, plus the seed data behind them. Rendered by the marketing landing
 * page and by the browser extension's first-run tab, so both surfaces show the
 * same product story. Consumers must also import "@aziru/ui/demo/styles".
 */

export { HeroFeedCard } from "./HeroFeedCard.js";
export { DemoTaxonomyCanvas } from "./DemoTaxonomyCanvas.js";
export { MailboxStage } from "./mailbox/MailboxStage.js";
export {
  AziruCompose,
  AziruReplyPill,
  DRAFTING_MS,
  type ReplyStage,
} from "./mailbox/AziruReply.js";
export { getDemoAziruData } from "./mailbox/aziruData.js";
export type { AziruDemoData, MockProvider } from "./mailbox/types.js";
export { FolderIcon, SparkleIcon, GmailLogoIcon } from "./icons.js";
export { DEMO_AVATARS, DEMO_MEMBER_AVATARS } from "./demo-avatars.js";
export {
  getDemoNodes,
  getDemoThreads,
  getDemoFolders,
  getDemoDraftBodies,
  getDemoSummaries,
  getDemoSummaryBullets,
  getDemoProviderLabels,
  getDemoMembers,
  getDemoComments,
  DEMO_COMMENT_THREAD_ID,
  DEMO_WORKSPACE_PLAN,
  DEMO_EDGES,
  DEMO_NODE_DEPTH,
  DEMO_NODE_SIZE,
  DEMO_ARROW,
} from "./demo-seed.js";
export type { DemoNode, DemoNodeData } from "./demo-seed.js";

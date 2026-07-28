/**
 * Shared product demos: the animated sorting feed and the interactive plan
 * canvas, plus the seed data behind them. Rendered by the marketing landing
 * page and by the browser extension's first-run tab, so both surfaces show the
 * same product story. Consumers must also import "@amarnai/ui/demo/styles".
 */

export { HeroFeedCard } from "./HeroFeedCard.js";
export { DemoTaxonomyCanvas } from "./DemoTaxonomyCanvas.js";
export { FolderIcon, SparkleIcon } from "./icons.js";
export { DEMO_AVATARS } from "./demo-avatars.js";
export {
  getDemoNodes,
  getDemoThreads,
  getDemoFolders,
  getDemoDraftBodies,
  getDemoSummaries,
  getDemoSummaryBullets,
  DEMO_EDGES,
  DEMO_NODE_DEPTH,
  DEMO_NODE_SIZE,
  DEMO_ARROW,
} from "./demo-seed.js";
export type { DemoNode, DemoNodeData } from "./demo-seed.js";

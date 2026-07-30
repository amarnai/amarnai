import type { I18n } from "@lingui/core";
import {
  getDemoProviderLabels,
  getDemoSummaries,
  getDemoSummaryBullets,
  getDemoDraftBodies,
} from "../demo-seed.js";
import type { AmarnaiDemoData } from "./types.js";

/**
 * Everything the Amarnai layer draws over a mailbox, in one call. Both surfaces
 * that render the mailbox demo need the same four maps in the same locale, and
 * assembling them separately in each was four imports and four useMemos apiece.
 */
export function getDemoAmarnaiData(i18n: I18n): AmarnaiDemoData {
  return {
    providerLabels: getDemoProviderLabels(i18n),
    summaries: getDemoSummaries(i18n),
    summaryBullets: getDemoSummaryBullets(i18n),
    draftBodies: getDemoDraftBodies(i18n),
  };
}

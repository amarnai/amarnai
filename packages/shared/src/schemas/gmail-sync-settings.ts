import { z } from "zod";

export const GmailSyncSettingsSchema = z.object({
  includeSpam:             z.boolean().default(false),
  includePromotions:       z.boolean().default(false),
  sortingPaused:           z.boolean().default(false),
  // Auto-file detected automated/bulk mail to the catch-all folder (no LLM).
  routeBulkToOther:        z.boolean().default(true),
  // Mirror folders as Gmail labels / Outlook categories. ON by default (the
  // write scope is granted upfront at connect when the feature is enabled);
  // inert without the scope, and users can switch it off per workspace.
  labelWritebackEnabled:   z.boolean().default(true),
  // Browser extension injects its thread-summary card into the native
  // Gmail/Outlook UI for this workspace. On by default; the extension has no
  // toggle of its own, so this is the only place it can be turned off.
  threadSummaryInjectionEnabled: z.boolean().default(true),
  // Browser extension injects its "Amarnai Reply" draft button into the native
  // Gmail/Outlook compose for this workspace. Separate from the summary toggle:
  // the two surfaces are independently useful, and drafting costs quota while
  // reading a summary of an already-open thread does not.
  replyButtonInjectionEnabled: z.boolean().default(true),
  blacklistedSenderEmails: z.array(z.string().email()).default([]),
});
export type GmailSyncSettings = z.infer<typeof GmailSyncSettingsSchema>;

export const DEFAULT_GMAIL_SYNC_SETTINGS: GmailSyncSettings = {
  includeSpam:             false,
  includePromotions:       false,
  sortingPaused:           false,
  routeBulkToOther:        true,
  labelWritebackEnabled:   true,
  threadSummaryInjectionEnabled: true,
  replyButtonInjectionEnabled: true,
  blacklistedSenderEmails: [],
};

export const UpdateGmailSyncSettingsSchema = z.object({
  includeSpam:           z.boolean().optional(),
  includePromotions:     z.boolean().optional(),
  sortingPaused:         z.boolean().optional(),
  routeBulkToOther:      z.boolean().optional(),
  labelWritebackEnabled: z.boolean().optional(),
  threadSummaryInjectionEnabled: z.boolean().optional(),
  replyButtonInjectionEnabled: z.boolean().optional(),
});
export type UpdateGmailSyncSettingsInput = z.infer<typeof UpdateGmailSyncSettingsSchema>;

export const AddBlacklistEmailSchema = z.object({
  email: z.string().email(),
});
export type AddBlacklistEmailInput = z.infer<typeof AddBlacklistEmailSchema>;

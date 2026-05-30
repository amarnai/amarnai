import { z } from "zod";

export const GmailSyncSettingsSchema = z.object({
  includeSpam:             z.boolean().default(false),
  includePromotions:       z.boolean().default(false),
  sortingPaused:           z.boolean().default(false),
  blacklistedSenderEmails: z.array(z.string().email()).default([]),
});
export type GmailSyncSettings = z.infer<typeof GmailSyncSettingsSchema>;

export const DEFAULT_GMAIL_SYNC_SETTINGS: GmailSyncSettings = {
  includeSpam:             false,
  includePromotions:       false,
  sortingPaused:           false,
  blacklistedSenderEmails: [],
};

export const UpdateGmailSyncSettingsSchema = z.object({
  includeSpam:       z.boolean().optional(),
  includePromotions: z.boolean().optional(),
  sortingPaused:     z.boolean().optional(),
});
export type UpdateGmailSyncSettingsInput = z.infer<typeof UpdateGmailSyncSettingsSchema>;

export const AddBlacklistEmailSchema = z.object({
  email: z.string().email(),
});
export type AddBlacklistEmailInput = z.infer<typeof AddBlacklistEmailSchema>;

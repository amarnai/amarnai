import { z } from "zod";

// Platforms that can register for push. v1 ships Android only; IOS is accepted
// by the schema so the same endpoint serves a future iOS build without change.
export const DevicePlatformSchema = z.enum(["ANDROID", "IOS"]);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

// Body for POST /devices. The Expo push token is opaque and validated only for
// shape (Expo returns ExponentPushToken[...] or ExpoPushToken[...]); the actual
// authority on validity is the Expo Push API at send time. We bound the length
// to reject obviously bogus payloads without coupling to Expo's exact format.
export const RegisterPushDeviceSchema = z.object({
  expoPushToken: z.string().min(1).max(512),
  platform: DevicePlatformSchema,
});
export type RegisterPushDeviceInput = z.infer<typeof RegisterPushDeviceSchema>;

// Android notification category id. Shared between the worker (which sets it on
// every emitted push) and the mobile app (which registers the matching inline
// actions under the same id). v1 is READONLY: the actions are read-oriented only
// (open the thread, mark reviewed in Amarnai state) and perform no Gmail writes.
export const PUSH_CATEGORY_THREAD_NEEDS_ATTENTION = "thread_needs_attention" as const;

// Android notification channel id for triage pushes.
export const PUSH_CHANNEL_TRIAGE = "triage" as const;

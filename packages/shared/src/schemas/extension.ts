import { z } from "zod";

// Browsers the side-panel extension ships for. Mirrors the Prisma
// `ExtensionBrowser` enum; the pair is small and closed (Chrome + Firefox).
export const ExtensionBrowserSchema = z.enum(["CHROME", "FIREFOX"]);
export type ExtensionBrowser = z.infer<typeof ExtensionBrowserSchema>;

// Body for POST /extension/register. The extension panel announces itself on
// load so the server knows the user has it (and can stop nudging them to
// install it). `version` is the extension's own version string, bounded to
// reject obviously bogus payloads without coupling to a fixed format.
export const RegisterExtensionSchema = z.object({
  browser: ExtensionBrowserSchema,
  version: z.string().min(1).max(32),
});
export type RegisterExtensionInput = z.infer<typeof RegisterExtensionSchema>;

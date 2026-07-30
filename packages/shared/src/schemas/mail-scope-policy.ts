import { z } from 'zod';

/**
 * What an OAuth client needs to know BEFORE it has a session: which mail scopes
 * to ask for. Whether the write scope belongs in the authorize request is
 * deployment config (`LABEL_WRITEBACK_ENABLED`), and a browser extension cannot
 * see it — the settings endpoint that carries `writebackAvailable` is
 * authenticated and workspace-scoped, so it is unreachable at sign-in time.
 *
 * One deployment-level boolean, no per-user or per-workspace fact, which is what
 * makes the endpoint serving it safe to leave public.
 */
export const MailScopePolicySchema = z.object({
  /** The deployment has label writeback switched on, so ask for the write scope. */
  writebackAvailable: z.boolean().default(false),
});
export type MailScopePolicy = z.infer<typeof MailScopePolicySchema>;

# Project Context

When working on Amarnai, prioritize readability, safety, and a focused feature set. Avoid clever abstractions and do not add out-of-scope features without explicit approval.

## About

Amarnai is an open-source, self-hostable AI email triage assistant. It is Gmail-first, but not a full email client.

Amarnai will also be offered as a hosted SaaS product. The codebase must support both deployment models equally. Design, architecture, storage layout, and API cost structure must never assume a single-tenant or fully self-managed environment. Specifically:

- Multi-tenancy must be a first-class concern: data isolation, per-user resource accounting, and tenant-scoped configuration should be built in, not retrofitted.
- AI and third-party API costs must be attributable per user so the hosted offering can track and control spend.
- Infrastructure choices (database, queues, storage) should have clear self-host-friendly defaults (e.g. Postgres, Redis, local file storage) while remaining swappable for managed cloud equivalents in production.
- Features that would be prohibitively expensive or operationally complex to run at scale in the hosted offering should be flagged before implementation.

Amarnai sorts email threads, not individual messages. New messages in existing threads trigger re-sorting of the full thread.

A key use case is bulk triage of an existing inbox: users may want to sort and classify thousands of emails already accumulated, not just handle incoming ones. Features and jobs should be designed to handle both ongoing (real-time) and historical (backfill) triage at scale.

## Monorepo

- `apps/web/` - Next.js frontend
- `apps/api/` - TypeScript API server
- `apps/worker/` - background jobs
- `packages/db/` - Prisma schema, migrations, client
- `packages/shared/` - shared types and Zod schemas
- `packages/ai/` - AI providers, prompts, output validation
- `packages/config/` - shared env/config

## AI & Policy

- Treat LLM output as untrusted.
- Validate structured AI output with Zod.
- Reject unknown node IDs, invalid paths, and invalid final destinations.
- Policy code decides final actions, not prompts.
- Keep mock sorting available for deterministic testing.
- Support local Ollama for dev and frontier LLMs for production through provider abstraction.
- Tune and commit routing/AI constants for the production model configuration (frontier Gemini). Self-hosted deployments on other models set their own constants; do not tune shipped defaults against the offline CI model.

## Safety & Privacy

- Never auto-send email.
- Never send from Amarnai GUI.
- Drafts require user approval.
- Store minimal email data.
- Never log full email bodies.
- Encrypt OAuth tokens and API keys at rest.
- Audit important actions.

## Workflow

- At the end of large tasks (multi-file changes, feature additions, refactors), provide a brief summary: what was changed, which files were affected, and any caveats or follow-up work.

## UX

- Minimize the number of clicks required to complete any action. Prefer inline controls, smart defaults, and progressive disclosure over multi-step flows.
- Both the marketing site and the web app must be fully responsive. All layouts, components, and interactions must work correctly on mobile, tablet, and desktop screen sizes.

## Cross-Platform Parity

- Before implementing any feature or change, check whether that functionality exists in both `apps/web/` and `apps/mobile/`. If it does, the change must be applied to both. Never update one without updating the other.

## Localization

Amarnai uses Lingui v5 for i18n across `apps/web`, `apps/site`, and `apps/mobile`. The source locale is English; all other languages are filled automatically by AI.

**Rules:**
- Never hardcode user-visible strings as plain text. Wrap every string in a Lingui macro.
- JSX content: `<Trans>My label</Trans>`
- Imperative strings (props, attributes, variables): `const { _ } = useLingui(); _( msg`My label`)`
- Dynamic values and plurals: use ICU MessageFormat inside the macro (`{name}`, `{count, plural, one {# item} other {# items}}`). Never concatenate strings.
- Write copy that is self-contained and unambiguous. Avoid idioms, wordplay, and split sentences across multiple macros.
- Settle on the final English text before wrapping. Changing a wrapped string creates a new catalog key and orphans the old translation.

**Pipeline (hook-owned — do not run manually):** the pre-commit hook runs `pnpm i18n:extract` → `pnpm i18n:translate` → `pnpm i18n:compile` automatically when string-touching files are staged. Just wrap strings in macros; the hook handles the rest at commit time. Only run `pnpm i18n:compile` by hand if you need compiled catalogs before committing (e.g. to verify new strings render).

## Standards

- TypeScript strict mode.
- Small files with explicit domain names.
- Idempotent, retry-safe background jobs.
- Test policy logic, AI output parsing, provider adapters, graph validity, and job behavior.
- Use centralized Amarnai design tokens; do not hardcode brand hex values in components.
- Do not duplicate logic or styles. Before adding new code or styles, check whether the behavior or style already exists and reuse or extend it instead.

## Non-Goals

- Outlook/IMAP support
- Team features
- Arbitrary workflow automation
- Kubernetes

## Testing

- Tests must never be adjusted to accommodate the algorithm. If a test is failing and the test itself is not flawed, fix the algorithm, NOT the test.
- When a process is started to run a test, kill it once the test is done. Do not leave test or dev processes running in the background.
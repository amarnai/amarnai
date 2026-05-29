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
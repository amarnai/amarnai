# Project Context

When working on Amarnai, prioritize readability, safety, and a focused MVP. Avoid clever abstractions and do not add non-MVP features without explicit approval.

## About

Amarnai is an open-source, self-hostable AI email triage assistant. It is Gmail-first, but not a full email client.

Amarnai sorts email threads, not individual messages. New messages in existing threads trigger re-sorting of the full thread.

Users define a visual email sorting tree. AI follows sorting questions on edges, chooses one final destination node, adds structured metadata, and sends uncertain/risky results to review.

Amarnai must not auto-send emails or send emails from its own GUI in the MVP.

## Monorepo

- `apps/web/` - Next.js frontend
- `apps/api/` - TypeScript API server
- `apps/worker/` - background jobs
- `packages/db/` - Prisma schema, migrations, client
- `packages/shared/` - shared types and Zod schemas
- `packages/ai/` - AI providers, prompts, output validation
- `packages/config/` - shared env/config

## Core Model

- Each workspace has one DB-backed root entry node: `Inbox`.
- All sorting starts from `Inbox`.
- `TaxonomyNode` = visual sorting step.
- A node may be a visible category/folder or a hidden sorting step.
- Final destination nodes must be visible categories and able to receive emails.
- `TaxonomyEdge` = sorting question from parent/source node to child/target node.
- Edges with missing/default sorting questions are invalid and ignored.
- Tags are user-controlled labels, optionally imported from Gmail later.
- Metadata is AI-generated: priority, urgency, risk, required action, sensitivity, due date, confidence, explanation, review status.
- Review queue handles low-confidence, sensitive, invalid, or risky results.

## AI & Policy

- Treat LLM output as untrusted.
- Validate structured AI output with Zod.
- Reject unknown node IDs, invalid paths, and invalid final destinations.
- Policy code decides final actions, not prompts.
- Keep mock sorting available for deterministic testing.
- Support local Ollama for dev and frontier LLMs for production through provider abstraction.

## Safety & Privacy

- Never auto-send email.
- Never send from Amarnai GUI in MVP.
- Drafts require user approval.
- Store minimal email data.
- Never log full email bodies.
- Encrypt OAuth tokens and API keys at rest.
- Audit important actions.

## Workflow

- At the end of large tasks (multi-file changes, feature additions, refactors), provide a brief summary: what was changed, which files were affected, and any caveats or follow-up work.

## Standards

- TypeScript strict mode.
- Small files with explicit domain names.
- Idempotent, retry-safe background jobs.
- Test policy logic, AI output parsing, provider adapters, graph validity, and job behavior.
- Use centralized Amarnai design tokens; do not hardcode brand hex values in components.

## Non-Goals

- Outlook/IMAP support
- Team features
- Arbitrary workflow automation
- Node marketplace
- Kubernetes
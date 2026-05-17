# Project Context

When working on Genizor, prioritize readability, safety, and a focused MVP. Avoid clever abstractions and do not add non-MVP features without explicit approval.

## About This Project

Genizor is a Gmail-first AI email triage assistant. It is not a full email client.

The app helps users define a simple visual email sorting map, classify Gmail emails with AI, add tags/metadata, review decisions, sync approved categories to Gmail labels, and create Gmail drafts.

Genizor must not auto-send emails or send emails from its own GUI in the MVP.

## Monorepo Structure

- `apps/web/` - Next.js frontend
- `apps/api/` - TypeScript API server
- `apps/worker/` - background jobs
- `packages/db/` - database schema, migrations, client
- `packages/shared/` - shared types, constants, validation schemas
- `packages/ai/` - AI provider abstraction, prompts, output parsing
- `packages/config/` - shared config

## Core Concepts

- Category/folder nodes: email destinations, optionally synced to Gmail labels
- Rule/helper nodes: influence classification or handling, not folders by default
- Tags: added to emails regardless of category
- Metadata: priority, urgency, risk, required action, sensitivity, due date
- Review queue: where uncertain or sensitive decisions are approved/corrected
- Policy engine: final authority for safe actions

## Standards

- TypeScript strict mode
- Zod for runtime validation
- Provider interfaces for Gmail and AI models
- Background jobs for sync, classification, labeling, and drafts
- Idempotent, retry-safe jobs
- Small files with explicit domain names
- Test policy logic, AI output parsing, provider adapters, and job behavior

## Safety & Privacy

- Treat LLM output as untrusted
- Policy code decides final actions, not prompts
- Never auto-send email
- Never send from Genizor GUI in MVP
- Drafts require user approval
- Store minimal email data
- Never log full email bodies
- Encrypt OAuth tokens and API keys at rest
- Audit important actions

## UI Guidelines

- The canvas is an email sorting map, not an automation builder
- Keep node configuration simple
- Prefer tags/metadata over extra system nodes
- Prefer clear defaults over advanced settings

## Non-Goals

- Full email client
- Auto-send
- Sending from Genizor GUI
- Outlook/IMAP support
- Team features
- Arbitrary workflow automation
- Node marketplace
- Kubernetes
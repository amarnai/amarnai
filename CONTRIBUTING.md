# Contributing to Aziru

## Before you start

Check the [open issues](https://github.com/aziruhq/aziru/issues) and [existing PRs](https://github.com/aziruhq/aziru/pulls) before starting work. For anything beyond a small bug fix, open an issue first to discuss the approach — this avoids wasted effort if the direction doesn't fit the project.

Aziru is intentionally focused. The supported email providers are Gmail and Outlook, both read-only; contributions that add other providers (IMAP and the like) or arbitrary workflow automation are unlikely to be accepted regardless of quality. See the Non-Goals section in [CLAUDE.md](CLAUDE.md).

## Contributor License Agreement

All contributions to Aziru are covered by our [Contributor License Agreement](CLA.md). Every pull request must have a signed CLA before it can be merged — an automated check will comment on your PR with a one-time signing link when you first open one. You sign once, and it covers all of your future contributions.

## Setup

Follow the setup steps in [README.md](README.md). The short version:

```bash
git clone https://github.com/aziruhq/aziru.git
cd aziru
pnpm install
cp .env.example .env        # fill in required values
cp .env.local.example .env.local
docker compose up -d        # starts Postgres and Redis
pnpm db:migrate
pnpm dev
```

## Making changes

### Branch naming

```
feat/short-description
fix/short-description
chore/short-description
```

Branch off `main` and target `main` in your PR.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add thing
fix(scope): correct thing
chore(scope): update thing
docs(scope): clarify thing
```

Scope is optional but preferred — use the package or app name (`web`, `api`, `worker`, `ai`, `db`, `shared`).

### Code style

- TypeScript strict mode throughout — no `any`, no type assertions without justification
- No comments unless the *why* is non-obvious (a hidden constraint, a workaround, a subtle invariant)
- No console.log left in submitted code
- Small files with explicit domain names; avoid barrel re-exports
- Reuse existing design tokens and utility functions — check before adding new ones

### Localization

User-visible strings must be wrapped in Lingui macros, never hardcoded: `<Trans>` in JSX, `` _(msg`...`) `` for imperative strings. English is the source locale; the other 15 are filled automatically. The pre-commit hook runs extract, translate, and compile, so you only need to wrap the string. See the Localization section in [CLAUDE.md](CLAUDE.md).

### Tests

```bash
pnpm test           # all packages
pnpm typecheck      # type-check all packages
pnpm lint           # lint all packages
```

Tests must pass before a PR will be reviewed. If a test is failing and the test itself is not flawed, fix the code — not the test.

AI output parsing, policy logic, provider adapters, and job behavior should be covered by tests. Mock the AI provider using the `mock` provider; do not make real API calls in tests.

## Pull request checklist

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] No secrets or credentials included
- [ ] `.env.example` updated if new environment variables were added
- [ ] PR description explains *why*, not just *what*

## Security

Do not report security vulnerabilities via GitHub issues. See [SECURITY.md](SECURITY.md).

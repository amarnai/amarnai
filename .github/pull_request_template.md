## Summary

<!-- What does this change do, and why? -->

## Platform parity

Amarnai ships a web app (`apps/web`) and a mobile app (`apps/mobile`). See
[docs/platform-parity.md](../docs/platform-parity.md).

- [ ] This change is **not** user-facing (infra, docs, tests, build), OR
- [ ] User-facing: I updated **both** `apps/web` and `apps/mobile`, OR
- [ ] User-facing but intentionally one platform: I recorded the gap in
      `docs/platform-parity.md`.

> Reminder: logic that is not literally JSX rendering belongs in a shared
> package (`@amarnai/core`, `@amarnai/shared`, `@amarnai/api-client`), not in a
> single app. The CI `parity-check` posts a warning if `apps/web`/`packages/ui`
> changed without a matching `apps/mobile` change.

## Testing

<!-- How was this verified? `pnpm typecheck`, `pnpm test`, manual steps, etc. -->

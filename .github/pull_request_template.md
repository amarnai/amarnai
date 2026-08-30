## Summary

<!-- What does this change do, and why? -->

## Parity

Amarnai's active clients are the web app (`apps/web`) and the browser extension
(`apps/extension`). The mobile app (`apps/mobile`) is shelved. Provider parity
(Gmail and Outlook, read-only) is also required. See
[docs/platform-parity.md](../docs/platform-parity.md).

- [ ] This change is **not** user-facing (infra, docs, tests, build), OR
- [ ] User-facing: I addressed the relevant active clients (`apps/web` and, where
      applicable, `apps/extension`), OR
- [ ] User-facing but intentionally one surface: I recorded the gap in
      `docs/platform-parity.md`.
- [ ] Provider parity: a triage feature touching one provider was also applied to
      the other (Gmail ↔ Outlook), or is provider-agnostic behind `packages/mail`.

> Reminder: logic that is not literally JSX rendering belongs in a shared
> package (`@aziru/core`, `@aziru/shared`, `@aziru/api-client`), not in a
> single app. A non-blocking CI `parity-check` posts a warning when `apps/web` or
> `packages/ui` change without a matching `apps/extension` change.

## Testing

<!-- How was this verified? `pnpm typecheck`, `pnpm test`, manual steps, etc. -->

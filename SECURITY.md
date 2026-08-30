# Security Policy

## Reporting a vulnerability

**Do not file a public GitHub issue for security vulnerabilities.**

Use [GitHub's private vulnerability reporting](https://github.com/aziruhq/aziru/security/advisories/new) to submit a report. You will receive a response within 5 business days.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions or components
- Any suggested mitigations, if you have them

## Scope

The following are in scope:

- Authentication and session handling (`apps/web/src/auth.ts`, NextAuth flows)
- OAuth token storage and encryption (`apps/web/src/lib/encryption.ts`, `apps/web/src/lib/gmail-oauth.ts`)
- API authorization and tenant data isolation (`apps/api/`)
- Email data handling and storage (anything that touches raw Gmail message content)
- Secrets management and environment variable handling

The following are **out of scope**:

- Vulnerabilities in third-party dependencies not directly introduced by this project
- Issues requiring physical access to the host machine
- Social engineering attacks
- Denial-of-service attacks that require excessive resources

## Disclosure policy

Once a report is confirmed, we aim to release a fix within 30 days and will coordinate disclosure timing with the reporter. Credit will be given in the release notes unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` is actively maintained. No backport policy exists at this time.

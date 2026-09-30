# Security Policy

## Reporting a Vulnerability
Please do not open public issues for security vulnerabilities.

Use GitHub Security Advisories for private reports on this repository.
If you cannot access advisories, contact a maintainer privately and include:
- affected component
- impact
- reproduction steps
- suggested remediation

## Secret Handling Rules
- Never commit real API keys, tokens, or credentials.
- Use `.env` for local secrets.
- Keep `.env.example` non-sensitive.
- Run `pre-commit run --all-files` before opening PRs.

## Secret Rotation
If a secret is exposed:
1. Revoke/rotate the secret immediately.
2. Remove leaked values from runtime/config.
3. Replace history if required by provider policy.
4. Open a remediation PR and describe impact.

## CI Exceptions

Security or CI exceptions must be temporary and accountable.

- Record them in `.github/ci-exceptions.json`.
- Every exception needs a named GitHub owner and a tracking issue or PR.
- Default SLA is 14 days from `openedOn` to `expiresOn`.
- Expired exceptions are expected to fail CI until renewed or removed.

## Automated coverage

- Every pull request and main-branch push audits the frozen pnpm dependency graph,
  including development and optional packages, at all advisory severity levels.
  The existing `required-ci` gate requires the audit to succeed; audit errors or
  skipped/cancelled runs do not count as a clean result.
- The same dependency audit runs every Monday at 04:37 UTC and can be started
  manually from the `dependency-audit` workflow. Scheduled failures appear in
  GitHub Actions; follow them through a reviewed dependency-update PR.
- CodeQL analyzes JavaScript/TypeScript (including Electron application code),
  the Python CI helper, and GitHub Actions workflows on pull requests, main pushes,
  and its weekly schedule. Actionlint, zizmor, and existing secret checks remain
  enabled. Native Electron/Chromium internals are covered by upstream advisories,
  not by the application CodeQL analysis.
- Dependabot configuration covers npm and GitHub Actions updates weekly. Its
  automatic security fixes and GitHub secret-scanning/push-protection features
  also depend on repository settings; workflow files alone do not enable them.
- A successful scan is evidence for its supported rules and advisory snapshot,
  not a guarantee that the application has no vulnerabilities.

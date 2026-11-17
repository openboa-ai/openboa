# Dependency security remediation specification

- Revision: `1`
- Status: `proposed; implementation awaits explicit acceptance of this revision`
- Date: `2026-11-17`
- Repository: `openboa-ai/openboa`
- Base: `475019c4a4baabaf78fed46110bb2b21fb1afc37`
- Change: `security-dependencies-20261117`

## Intent and baseline

The user requests inspection and remediation of OpenBoa organization security issues,
with verified fixes delivered as draft pull requests. This change closes the current
openboa dependency alerts using official, compatible security releases while preserving
application behavior and existing security checks. The inspected baseline has 38 open
Dependabot alerts in `pnpm-lock.yaml`: 1 critical, 14 high, 15 medium and 8 low.
Code scanning and secret scanning are readable and return zero open alerts; those
results do not establish absence of vulnerabilities beyond their analysis coverage.

## Authority, data and delivery boundaries

- Work only on the isolated `codex/security-dependencies-20261117` branch.
- Read sanitized alert identifiers, package names, dependency paths and advisory metadata.
  Do not record secret values, credentials or unrelated private data.
- Download packages only from the official npm registry and use upstream-maintained
  security releases after confirming exact versions and package integrity metadata.
- Preserve pnpm lifecycle-script permissions, existing overrides unrelated to this
  alert set, package-manager version, workflow permissions and required checks.
- A reviewed draft PR is the delivery target. Push and draft publication are separate
  tracked steps; this specification does not authorize merge, deploy or release.
- Security settings, repository permissions, branch protection, secret rotation and
  new credentials require separate, specific approval and are prohibited here.

## Requirements

- R1: Upgrade direct development dependency floors for Electron, Vite and Vitest to
  their listed patched releases within their existing majors. Keep runtime dependency
  declarations and application, agent, shell, UI and protocol source unchanged.
- R2: Update existing vulnerable same-major override pins for fast-uri,
  follow-redirects, markdown-it and undici. Refresh fast-xml-parser, source-map-js
  and proxy-addr in the lockfile within existing compatible consumer ranges.
  Prefer narrowly targeted lockfile resolution over adding an unnecessary override.
- R3: Target the exact minimum patched releases below. Permit only package-manager
  generated dependency/peer updates required by those releases; inspect and revert
  unrelated graph churn. Do not use a broad latest-version upgrade or an alias to
  an unofficial package.
- R4: Account for every baseline alert. Alert #214 remains explicitly unresolved:
  the official basic-ftp advisory affects versions through 6.2.3 and identifies
  6.2.4 as patched, while the existing override is 5.3.1. A cross-major update,
  dependency removal, patch or consumer migration needs a separate reviewed revision
  with source-backed compatibility evidence. Do not suppress or dismiss this alert.
- R5: Retain all existing test/CI/audit controls and behavior. No app/UI refactor,
  workflow or policy changes, alert dismissal, new credentials or security-control
  changes are within this change.

## Complete baseline alert map

All entries below refer to the repository's Dependabot alerts and `pnpm-lock.yaml`.
Each target must be verified against current official registry metadata before use.

| Package | Alert identifiers | Baseline to target / disposition |
| --- | --- | --- |
| `basic-ftp` | #214 | Blocked: 5.3.1 to 6.2.4 crosses the accepted major boundary |
| `fast-xml-parser` | #213 | 5.7.3 to 5.12.0 |
| `undici` | #212, #211, #210, #209, #208, #207, #206, #198, #195 | 6.28.1 to 6.29.1; 7.29.1 to 7.30.1 |
| `fast-uri` | #203, #202, #201, #196 | 3.1.8 to 3.1.9 |
| `electron` | #194, #193, #192, #191, #190, #189, #188, #185 | 43.5.0 to 43.8.1 |
| `@vitest/mocker` | #187, #186 | 4.1.11 to 4.1.12 through vitest 4.1.12 |
| `vite` | #184, #183, #182, #176, #175, #174 | 8.2.0 to 8.2.4 |
| `markdown-it` | #181, #180, #177 | 14.3.1 to 14.3.3 |
| `follow-redirects` | #179, #178 | 1.16.0 to 1.16.1 |
| `source-map-js` | #170 | 1.2.1 to 1.2.2 |
| `proxy-addr` | #169 | 2.0.7 to 2.0.8 |

## Compatibility and failure lifecycle

- Use the repository's pinned pnpm 10.23.0 and a supported Node runtime (>=22.12.0).
  Frozen installation must reproduce the resulting graph without lockfile changes.
- Keep the existing `onlyBuiltDependencies` list unchanged. Baseline graph inspection
  can disable lifecycle scripts; desktop packaging must use the existing approved
  dependency build permissions when exercising Electron.
- Registry/network/storage failure is blocked verification, not a successful fix.
  Retry only after reconciling the observed outcome; do not use an internal disk
  fallback, alternate registry or guessed package integrity.
- An incompatible consumer range, peer mismatch, failed build or regression returns
  the change to review. Revert a failed attempt instead of keeping speculative fixes.
- Any newly observed advisory or major-version requirement is reported explicitly;
  this specification does not automatically expand to unrelated upgrades.
- Local graph remediation, draft PR CI success, merge and alert closure on the
  default branch are separate states. Do not claim alerts closed before GitHub
  analyzes the merged default-branch dependency graph.

## Requirement-linked acceptance evidence

| Requirement | Required evidence |
| --- | --- |
| R1-R3 | Before/after exact package versions, official registry integrity metadata, reviewed manifest/lockfile diff, unchanged script-permission configuration and frozen install. |
| R4 | Mapping of all 38 identifiers to verified patched graph nodes or the explicitly blocked #214; all 37 same-major targets absent from the resulting audit advisories. |
| R5 | Existing `pnpm check`, archive-extraction security regression tests, docs lint/link/structure gates, and macOS desktop packaging pass on the candidate commit; record environment-limited failures accurately. |
| R1-R5 | Independent review of the immutable diff and current trusted CI results on the exact draft PR commit before handoff for final human signoff. |

Record a baseline audit and baseline check results before dependent edits. Run the
same checks after the bounded update. The unchanged all-severity audit may continue
to fail for #214; report its exact remaining advisory instead of weakening the gate.
Full remediation and landing readiness require resolving that boundary separately.

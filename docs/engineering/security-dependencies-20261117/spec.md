# Dependency security remediation specification

- Revision: `2`
- Status: `proposed; revision 1 was accepted; revised scope awaits explicit acceptance`
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
The separate official npm audit reports 54 advisory records / 49 unique GHSAs /
55 reported vulnerability occurrences (1 critical, 19 high, 26 moderate, 9 low).
The GitHub inventory represents 38 alert entries / 34 unique GHSAs.
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
  follow-redirects, markdown-it, undici, body-parser, ip-address, qs, smol-toml,
  and the existing sharp override from 0.35.4 to the patch release 0.35.5.
  Refresh source-map-js, proxy-addr and postcss-selector-parser in the lockfile
  within their consumers' compatible ranges. Add only the scoped override
  `@mintlify/scraping>fast-xml-parser: 5.12.0`, because scraping pins 5.7.3 exactly;
  retain the same v5 XMLParser API and verify the consumer's PHPDoc parsing options.
  Prefer narrowly targeted lockfile resolution over any additional override.
- R3: Target the exact minimum patched releases below. Permit only package-manager
  generated dependency/peer updates required by those releases; inspect and revert
  unrelated graph churn. Do not use a broad latest-version upgrade or an alias to
  an unofficial package.
- R4: Account for every baseline alert. Alert #214 remains explicitly unresolved:
  the existing basic-ftp override is 5.3.1, and the currently suitable upstream
  fix is 6.2.6 (6.2.4 alone introduces another known path-traversal advisory).
  The sole consumer get-uri 6.0.5 requires ^5.0.2, so the change crosses its range.
  Also retain explicit unresolved decisions for zod 3.25.76 to 4.6.6,
  minimatch 9.0.9/10.2.6 to 11.0.1, and katex 0.16.47 to 0.18.2.
  Their observed consumers require v3/exact v4, ^9/^10 and ^0.16.0 respectively;
  current global zod v3 overrides already substitute one v4 consumer. A cross-major
  update, removal, patch or consumer migration needs a separately reviewed revision
  with source-backed compatibility evidence. Do not suppress or dismiss any alert.
- R5: Retain all existing test/CI/audit controls and behavior. No app/UI refactor,
  workflow or policy changes, alert dismissal, new credentials or security-control
  changes are within this change.
- R6: Keep the expired `merge-canary-read-only-workflow-run` exception in
  `.github/ci-exceptions.json` unchanged. Its expiry on 2026-10-14 causes the
  baseline policy/aggregate gate to fail. A passing component suite does not
  replace this failed gate or authorize an exception renewal.
- R7: Add only a focused dependency-boundary regression test in
  `test/dependency-parser-security.test.ts` for the actual docs Express
  proxy-addr resolution. Reject spoofing through short IPv4-mapped IPv6 and
  zero-leading IPv6 trust subnets while retaining correctly scoped IPv4/mapped
  proxy behavior. Exercise the existing XMLParser PHPDoc options as a legitimate
  compatibility control for the explicitly scoped parser override. No production
  code, test configuration, workflow or evaluator changes are allowed.

## Complete baseline alert map

All entries below refer to the repository's Dependabot alerts and `pnpm-lock.yaml`.
Each target must be verified against current official registry metadata before use.

| Package | Alert identifiers | Baseline to target / disposition |
| --- | --- | --- |
| `basic-ftp` | #214 | Blocked: 5.3.1 to 6.2.6 crosses the consumer major boundary |
| `fast-xml-parser` | #213 | 5.7.3 to 5.12.0 |
| `undici` | #212, #211, #210, #209, #208, #207, #206, #198, #195 | 6.28.1 to 6.29.1; 7.29.1 to 7.30.1 |
| `fast-uri` | #203, #202, #201, #196 | 3.1.8 to 3.1.9 |
| `electron` | #194, #193, #192, #191, #190, #189, #188, #185 | 43.5.0 to 43.8.1 |
| `@vitest/mocker` | #187, #186 | 4.1.11 to 4.1.12 through vitest 4.1.12 |
| `vite` | #184, #183, #182, #176, #175, #174 | 8.2.0 to 8.2.4 |
| `markdown-it` | #181, #180, #177 | 14.3.1 to 14.3.3 |
| `follow-redirects` | #179, #178 | 1.16.0 to 1.16.2 |
| `source-map-js` | #170 | 1.2.1 to 1.2.2 |
| `proxy-addr` | #169 | 2.0.7 to 2.0.8 |


## Additional audit-derived targets

The 15 additional unique GHSAs below came from the same frozen graph's official
registry audit. They are not fabricated GitHub alert identifiers. The accepted
compatible boundary aims to remove 43 of the 49 unique audit GHSAs while retaining
6 explicit blocked GHSAs in basic-ftp, katex, zod and minimatch.

| Package | Baseline to target / disposition | Additional GHSAs |
| --- | --- | --- |
| `basic-ftp` | Blocked 5.3.1 to 6.2.6 outside get-uri ^5.0.2 | GHSA-c475-qrg2-pj4r, GHSA-r4jh-29pc-gfqr |
| `smol-toml` | Existing override 1.7.1 to 1.9.0; markdownlint-cli2 requires exact 1.7.0 | GHSA-r4xh-jqrq-34v2 |
| `katex` | Blocked 0.16.47 to 0.18.2 outside both consumers' ^0.16.0 range | GHSA-238p-pmpm-9mq7 |
| `sharp` | Existing override 0.35.4 to 0.35.5, same patch line | GHSA-wq5f-xc86-pv6w |
| `ip-address` | Existing override 10.7.1 to 10.7.4, within socks ^10.1.1 | GHSA-rxp7-6hxx-x8q5 |
| `zod` | Blocked global 3.25.76 to 4.6.6; preserve consumer API decisions | GHSA-mrhx-c7xc-m3w5 |
| `body-parser` | Existing override 1.20.6 to 1.20.9, same minor line | GHSA-27r3-jxmh-p828 |
| `undici` | Existing overrides 6.28.1 to 6.29.1 and 7.29.1 to 7.30.1 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-55wc-3pg8-jfw6 |
| `postcss-selector-parser` | Lock-only 6.1.4 to 6.1.5 within ^6.1.1 / ^6.1.2 | GHSA-rj75-hqrm-r3gf |
| `qs` | Existing override 6.16.0 to 6.16.1 | GHSA-6pq8-jhm2-2vcw |
| `follow-redirects` | Correct minimum target to 1.16.2 within axios ^1.16.0 | GHSA-mrwp-f3q8-3g9p |
| `minimatch` | Blocked 9.0.9 / 10.2.6 to 11.0.1 outside Electron-builder consumers' ^9 / ^10 | GHSA-g3hv-75wg-m249 |

Official advisories for the explicit boundaries: [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[XML parser](https://github.com/advisories/GHSA-474x-hrwr-fgx4),
[basic-ftp](https://github.com/advisories/GHSA-5pm8-86m8-9m6r),
[follow-redirects](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).

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
| R4 | All 38 GitHub alert entries mapped: 37 entries / 33 unique GHSAs patched and #214 blocked; 43 of 49 unique registry-audit GHSAs absent, with every remaining package/version/path reported. |
| R5-R6 | Run unchanged `pnpm check`; record the baseline expired-exception failure honestly. Separately require formatter, lint, typecheck, web build, full Vitest suite, archive-extraction regression tests, docs lint/link/structure, and macOS desktop packaging; they do not override the aggregate gate. |
| R7 | Baseline malicious proxy subnets reproduce spoofed client IP while proper subnet controls pass; candidate must reject both attack representations, retain legitimate scoped behavior, and preserve the PHPDoc XML parsing fixture. |
| R1-R7 | Independent review of the immutable diff and current trusted CI results on the exact draft PR commit before handoff for final human signoff. |

Record a baseline audit and baseline check results before dependent edits. Run the
same checks after the bounded update. The unchanged all-severity audit may continue
to fail for the four blocked packages; report their exact remaining advisories instead
of weakening the gate. The policy gate remains independently blocked by its expired
exception.
Full remediation and landing readiness require resolving that boundary separately.

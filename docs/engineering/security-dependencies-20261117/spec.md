# Dependency security remediation specification

- Revision: `4`
- Status: `proposed; revision 3 was accepted; failed TOML target is discarded and awaits review`
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
  follow-redirects, markdown-it, undici, body-parser, ip-address, qs,
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
- R4: Account for every baseline alert. Replace the global basic-ftp 5.3.1 override
  with the consumer-scoped `get-uri>basic-ftp: 6.2.6` override. This is the single
  explicitly reviewed cross-major exception to R1-R3. The only installed consumer,
  get-uri 6.0.5, uses Client/access/lastMod/list/downloadTo/close, all retained by
  the verified upstream 6.2.6 API. Version 6.2.4 alone introduces another known
  path-traversal advisory and is not an acceptable target.
  Retain explicit unresolved decisions for zod 3.25.76 to 4.6.6,
  minimatch 9.0.9/10.2.6 to 11.0.1, and katex 0.16.47 to 0.18.2.
  Also preserve smol-toml 1.7.1 after discarding the attempted 1.9.0 update:
  the actual markdownlint-cli2 0.23.2 / markdownlint 0.41.1 consumer ignores
  per-rule options from its new null-prototype TOML tables. The isolated real CLI
  accepts a JSON line_length=120 override but ignores the equivalent TOML override,
  failing a legitimate 99-character whitespace-separated line at the default 80.
  The other blocked consumers require v3/exact v4, ^9/^10 and ^0.16.0 respectively;
  current global zod v3 overrides already substitute one v4 consumer. A cross-major
  update, removal, patch or consumer migration needs a separately reviewed revision
  with source-backed compatibility evidence. The TOML issue needs an independently
  reviewed upstream-compatible parser/consumer mechanism; no app-level shim or
  weakened lint behavior is authorized. Do not suppress or dismiss any alert.
- R8: Preserve the upstream secure FTP defaults: do not enable
  `allowSeparateTransferHost`. Data transfers must never connect to a foreign
  PASV-advertised host. Upstream 6.2.6 rejects an incompatible advertised host;
  permitted loopback aliases still connect to the control host. A safe control-host
  substitution is acceptable; do not invent a requirement to contact split-host
  data services. No current repository contract requires split-host FTP.
- R9: In `test/dependency-ftp-security.test.ts`, resolve get-uri through the real
  docs downloader/proxy consumer chain. Use bounded local fake FTP servers to
  exercise ordinary same-host downloads and unsupported-MDTM to LIST fallback,
  malformed MLSD inherited-property facts such as `__proto__`, and an alternate
  inherited fact representation. Verify no connection to an unrelated advertised
  data host occurs before any expected rejection or safe substitution, and retain
  legitimate listings/file bytes. Bind ephemeral loopback ports only, close every
  socket/server on success and failure, and make no external FTP connection.
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

- R10: Add only `test/dependency-toml-compatibility.test.ts` to retain the actual
  markdownlint-cli2 executable boundary: isolated configuration, a default 80-char
  negative control, equivalent JSON and TOML line_length=120 positive controls,
  and a whitespace-separated 99-character line. This test must fail with the
  discarded smol-toml 1.9.0 graph and pass with the preserved compatible baseline.
  Use a fresh temporary directory and remove it on success or failure.

## Complete baseline alert map

All entries below refer to the repository's Dependabot alerts and `pnpm-lock.yaml`.
Each target must be verified against current official registry metadata before use.

| Package | Alert identifiers | Baseline to target / disposition |
| --- | --- | --- |
| `basic-ftp` | #214 | 5.3.1 to 6.2.6 through the explicitly reviewed get-uri scoped override |
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
revised boundary aims to remove 45 of the 49 unique audit GHSAs while retaining
4 explicit blocked GHSAs in katex, zod, minimatch and smol-toml.

| Package | Baseline to target / disposition | Additional GHSAs |
| --- | --- | --- |
| `basic-ftp` | Explicit get-uri-scoped 5.3.1 to 6.2.6 exception, with secure defaults | GHSA-c475-qrg2-pj4r, GHSA-r4jh-29pc-gfqr |
| `smol-toml` | Blocked: preserve 1.7.1; attempted 1.9.0 breaks actual CLI per-rule TOML options | GHSA-r4xh-jqrq-34v2 |
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
| R4 | All 38 GitHub alert entries mapped: 38 entries / 34 unique GHSAs patched; 45 of 49 unique registry-audit GHSAs absent, with every remaining package/version/path reported. |
| R5-R6 | Run unchanged `pnpm check`; record the baseline expired-exception failure honestly. Separately require formatter, lint, typecheck, web build, full Vitest suite, archive-extraction regression tests, docs lint/link/structure, and macOS desktop packaging; they do not override the aggregate gate. |
| R7 | Baseline malicious proxy subnets reproduce spoofed client IP while proper subnet controls pass; candidate must reject both attack representations, retain legitimate scoped behavior, and preserve the PHPDoc XML parsing fixture. |
| R8-R9 | Exact official 6.2.6 API/integrity metadata; real get-uri ordinary and LIST-fallback downloads; malicious inherited MLSD facts handled safely; foreign data-host connection count stays zero; existing secure defaults remain unchanged. |
| R10 | Actual CLI2 default-80 negative control fails while equivalent JSON and TOML line_length=120 controls both pass after discarding the incompatible update. |
| R1-R10 | Independent review of the immutable diff and current trusted CI results on the exact draft PR commit before handoff for final human signoff. |

Record a baseline audit and baseline check results before dependent edits. Run the
same checks after the bounded update. The unchanged all-severity audit may continue
to fail for the four blocked packages; report their exact remaining advisories instead
of weakening the gate. The policy gate remains independently blocked by its expired
exception.
Full remediation and landing readiness require resolving that boundary separately.

## Observed residual upstream FTP error behavior

get-uri 6.0.5 attaches only a success handler to Client.downloadTo(). A rejected
transfer can therefore produce an empty stream and an unhandled rejected promise.
That pre-existing upstream error path is not fixed by this dependency update.
The foreign-host negative regression exercises the actual get-uri-resolved Client
promise directly, so rejection is handled and the zero-foreign-connection invariant
is verified without asserting a nonexistent stream-error contract. Normal get-uri
and MDTM-to-LIST flows are exercised end to end. No consumer/application workaround
is included; any error-propagation fix requires a separately reviewed mechanism.

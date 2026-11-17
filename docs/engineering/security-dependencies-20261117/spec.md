# Dependency security remediation specification

- Revision: `5`
- Status: `accepted for R11-R15; Zod/reporter mechanisms remain gated`
- Reviewed content SHA-256: `04a066f3dc24251850d79a58029c5248342c22ac24b693dc8369af41abedc137`
- Acceptance: delegated project lead, `2026-11-17T11:45:53Z`; routine user-authorized follow-up, not new policy/settings/merge authority
- Date: `2026-11-17`
- Repository: `openboa-ai/openboa`
- Base: `475019c4a4baabaf78fed46110bb2b21fb1afc37`
- Change: `security-dependencies-20261117`
- Follow-up base: `b972948cbf72aaf2f0ce8121b32f0cc2b9311aad`
- Delivery: continue draft PR `#78`

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

The follow-up user request continues the same PR to resolve the four remaining
registry-audit GHSAs, the expired exception and the 17 existing whitespace/EOF
failures with real fixes. No exception extension, scanner disabling, repository
settings change, merge, auto-merge or deployment is authorized. Revision 5 permits
three source-backed dependency fixes and the exact whitespace frontier below.
Zod and the read-only reporter replacement remain gated for a later reviewed
revision while their concrete mechanisms are investigated; they are still required
for completion of the user's overall goal.


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
  Revision 5 additionally permits only the scoped minimatch, KaTeX and TOML
  mechanisms in R11-R13. Zod remains unchanged until a separately reviewed
  implementation closes both v4 and required v3/embedded representations with
  actual consumer compatibility. A version-label change or removal from the audit
  dependency graph is not a security fix for executable bundled code.
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
  changes are within revision 5. The user-authorized reporter replacement requires
  its own accepted mechanism before dependent edits.
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
  and a whitespace-separated 99-character line. The unpatched new-parser graph
  must reproduce the option-loss failure; smol-toml 1.9.1 plus the accepted native
  markdownlint patch must retain those options.
  Use a fresh temporary directory and remove it on success or failure.

- R11: Replace the global smol-toml 1.7.1 pin with only
  `markdownlint-cli2>smol-toml: 1.9.1`. Use pnpm 10.23.0's native patched dependency
  mechanism for `markdownlint@0.41.1`; retain the upstream package version, license
  and exports. Change only the existing `value instanceof Object` option-object
  condition inside the truthy-value branch to also accept null-prototype tables:
  `value instanceof Object || (typeof value === "object" && Object.getPrototypeOf(value) === null)`.
  Keep all previously accepted objects, arrays and functions; preserve primitive
  booleans and warning severity semantics. The rest of option copying, metadata
  handling and rule evaluation is unchanged. The inspected original
  `lib/markdownlint.mjs` SHA-256 is
  `9a65aa5a5c75d027420f22cd26f132cd63b8387df49f77f94bdc251d5afe7c85`.
  Generate the patch with pnpm, record its exact version/path/hash in native package
  metadata/lockfile, and fail frozen installation on mismatch or unapplied patch.
  Do not add a host postinstall adapter or mutate a shared installed dependency.
- R12: Add only `app-builder-lib>minimatch: 11.0.1` and
  `@electron/universal>minimatch: 11.0.1`. Preserve every callable minimatch v3/v5
  consumer. The real app-builder-lib FileMatcher constructs Minimatch with
  `{dot:true}` and consumes `.set`, `.negate`, `.match` and partial directory
  matching; the universal/ASAR/plist paths use named minimatch with `{matchBase:true}`.
  Verify actual FileMatcher include/exclude, dotfile, brace, extglob, normalized
  pattern and partial-directory behavior, both named universal signatures, and the
  ordinary production desktop package. Include the advisory optimizationLevel=2
  repeated globparts trigger in an isolated bounded process; do not change its
  consumer options or disable pattern features to avoid the finding.
- R13: Add only `micromark-extension-math>katex: 0.18.2` and
  `rehype-katex>katex: 0.18.2`. Verify both real renderers, including normal inline
  and display math, explicit trust opt-in, default trust denial, malformed math
  behavior and inherited trust/renderer-option/namespace representations from the
  upstream advisory. Generated HTML must not gain attacker-controlled links or
  external-resource elements from inherited options. Isolate global-prototype
  attack controls in a child process or restore every descriptor in a finally
  block; never weaken renderer trust settings to pass a test.
- R14: Apply only the existing trailing-whitespace/end-of-file hooks' changes to
  the exact 17 paths below. Preserve all words, links, configuration values, file
  paths and file modes. Keep `.gitkeep` files as empty files, never delete them.
  Remove only trailing whitespace and normalize the final newline/empty-file form
  to the existing hook contract. No scanner/hook configuration or new exclusion is
  permitted. Document any Markdown hard-break spacing normalized by that existing
  hook rather than claiming unrelated content edits.
- R15: Rerun complete unsuppressed audit, frozen install, pnpm checks, focused
  dependency security/consumer controls, docs checks, macOS packaging and
  `pre-commit run --all-files` on the resulting exact commit. A second pre-commit
  run must make no further changes. Until separately accepted Zod/reporter work
  lands on this branch, retain their known audit/policy failures honestly; a
  partial iteration is not completion or permission to merge.

## Revision 5 owned paths

Dependency changes are limited to `package.json`, `pnpm-lock.yaml`, native
`patchedDependencies` metadata in `pnpm-workspace.yaml` if generated by pnpm,
`patches/markdownlint@0.41.1.patch`, existing dependency-boundary regression tests,
new `test/dependency-consumer-compatibility.test.ts`, and this specification/wiki
frontier records. Native metadata may contain only the exact patch mapping; do not
change workspace membership or unrelated settings. No production app code changes.

The whitespace-only frontier is exactly:

- `.detect-secrets.cfg`
- `.editorconfig`
- `.env.example`
- `.gitattributes`
- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.npmrc`
- `.nvmrc`
- `apps/.gitkeep`
- `docs/introduction.md`
- `docs/ko/introduction.md`
- `extensions/.gitkeep`
- `packages/.gitkeep`
- `raw/sources/assets/.gitkeep`
- `raw/sources/inbox/.gitkeep`
- `raw/sources/library/.gitkeep`
- `wiki/syntheses/claude-managed-agents-reverse-engineering.md`

## Gated follow-up mechanisms

- Zod GHSA-mrhx-c7xc-m3w5: investigate the official 4.6.6 bounds fix, the CLI's
  actual v4 contract, required v3 `_def`/converter contracts and executable bundled
  copies. No global v4 substitution, fake alias/version, disabling validation,
  dropping docs:local or large Mintlify migration is accepted by revision 5.
- Reporter exception: retain the current workflow and expired entry unchanged in
  revision 5. A trusted-main schedule/inputless-manual read-only replacement may
  be proposed separately with bounded polling and all original proof/evaluator
  gates retained. No exception renewal, ignored warning, new writer/credential,
  activation of the OFF writer pilot or modification of its fixed PR68 target.

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
revision 5 boundary aims to remove 48 of the 49 unique original audit GHSAs.
Zod remains gated; the overall follow-up must ultimately satisfy an unsuppressed
zero-advisory audit without leaving vulnerable bundled code.

| Package | Baseline to target / disposition | Additional GHSAs |
| --- | --- | --- |
| `basic-ftp` | Explicit get-uri-scoped 5.3.1 to 6.2.6 exception, with secure defaults | GHSA-c475-qrg2-pj4r, GHSA-r4jh-29pc-gfqr |
| `smol-toml` | 1.7.1 to 1.9.1 plus exact native markdownlint0.41.1 compatibility patch | GHSA-r4xh-jqrq-34v2 |
| `katex` | 0.16.47 to 0.18.2 scoped to both actual math renderers | GHSA-238p-pmpm-9mq7 |
| `sharp` | Existing override 0.35.4 to 0.35.5, same patch line | GHSA-wq5f-xc86-pv6w |
| `ip-address` | Existing override 10.7.1 to 10.7.4, within socks ^10.1.1 | GHSA-rxp7-6hxx-x8q5 |
| `zod` | Blocked global 3.25.76 to 4.6.6; preserve consumer API decisions | GHSA-mrhx-c7xc-m3w5 |
| `body-parser` | Existing override 1.20.6 to 1.20.9, same minor line | GHSA-27r3-jxmh-p828 |
| `undici` | Existing overrides 6.28.1 to 6.29.1 and 7.29.1 to 7.30.1 | GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-55wc-3pg8-jfw6 |
| `postcss-selector-parser` | Lock-only 6.1.4 to 6.1.5 within ^6.1.1 / ^6.1.2 | GHSA-rj75-hqrm-r3gf |
| `qs` | Existing override 6.16.0 to 6.16.1 | GHSA-6pq8-jhm2-2vcw |
| `follow-redirects` | Correct minimum target to 1.16.2 within axios ^1.16.0 | GHSA-mrwp-f3q8-3g9p |
| `minimatch` | 9.0.9 / 10.2.6 to 11.0.1 scoped to app-builder-lib and universal consumers | GHSA-g3hv-75wg-m249 |

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
| R4 | All 38 GitHub alert entries mapped: 38 entries / 34 unique GHSAs patched; 48 of 49 unique registry-audit GHSAs absent after revision 5; Zod explicitly gated, with every remaining package/version/path reported. |
| R5-R6 | Run unchanged `pnpm check`; record the baseline expired-exception failure honestly. Separately require formatter, lint, typecheck, web build, full Vitest suite, archive-extraction regression tests, docs lint/link/structure, and macOS desktop packaging; they do not override the aggregate gate. |
| R7 | Baseline malicious proxy subnets reproduce spoofed client IP while proper subnet controls pass; candidate must reject both attack representations, retain legitimate scoped behavior, and preserve the PHPDoc XML parsing fixture. |
| R8-R9 | Exact official 6.2.6 API/integrity metadata; real get-uri ordinary and LIST-fallback downloads; malicious inherited MLSD facts handled safely; foreign data-host connection count stays zero; existing secure defaults remain unchanged. |
| R10 | Actual CLI2 default-80 negative control fails while equivalent JSON and TOML line_length=120 controls both pass after discarding the incompatible update. |
| R11 | Native pnpm patch metadata/hash, exact original source digest, frozen fresh install and unpatched-negative/patched-positive CLI TOML, JSON, YAML, metadata/severity and legitimate parser controls. |
| R12-R13 | Actual packaging/renderer consumer behavior plus bounded advisory triggers; no vulnerable minimatch >=7 copies or vulnerable KaTeX copies remain and legacy callable minimatch copies are unchanged. |
| R14 | Exactly 17 hook-selected whitespace diffs, stable file modes and retained empty .gitkeep files; full pre-commit succeeds and a repeat run makes no edits. |
| R15 | Exact-commit results; remaining Zod/policy blockers remain visible until separately reviewed mechanisms satisfy all required gates. |
| R1-R15 | Independent review of the immutable diff and current trusted CI results on the exact draft PR commit before handoff for final human signoff. |

Record a baseline audit and baseline check results before dependent edits. Run the
same checks after the bounded update. The unchanged all-severity audit may continue
to fail for gated Zod after revision 5; report its exact remaining advisories instead
of weakening the gate. Recheck all newly observed advisories rather than assuming
that the original inventory is complete. The policy gate remains independently blocked by its expired
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

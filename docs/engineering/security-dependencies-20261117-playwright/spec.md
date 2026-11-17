# Playwright bundled Zod remediation specification

- Revision: `8-playwright`
- Status: `accepted for R23-R28 implementation`
- Reviewed proposal SHA-256: `0b285df5bbc78f265b49acde9dc640ab3bcada977fc13a76d8694ba02ad1d314`
- Acceptance: delegated project lead, `2026-11-17T13:32:03Z`, after complete spec and independent official source/representation review; no settings, credentials, browser installation or publication authority added
- Repository: `openboa-ai/openboa`
- Baseline: immutable unpublished candidate `735b202e43260ebfbd11980d555d7aafa29db3bb`
- Delivery: continue draft PR78; no push, merge, auto-merge or deployment in this worker scope
- Relationship: R22 requires returning a newly discovered executable copy to mechanism review; dependency revision 6 and reporter revision 7.1 remain accepted and unchanged

## Intent, finding and severity

The user requests verified remediation of security issues without hiding them by
removing dependencies, renaming versions or weakening controls. Independent review
found a missed bundled Zod representation in active direct development dependency
Playwright 1.62.1, through playwright-core's distributed `lib/utilsBundle.js`.

The real exported `Client.complete` calls `Protocol.request`, whose response handler
calls the bundled `safeParse3` with `CompleteResultSchema`. The schema declares
`completion.values` as `array(string()).max(100)`. The bundled Zod v4.4.3 parser
walks all children before enforcing that bound. A bounded fake-transport response
with 101 entries and a throwing first-entry getter reaches child work before the
existing maximum can reject it according to the source trace; R25 requires
recording that bounded functional observation separately. The public exported
v4 `z` parser is also present.

Calibrate this as medium severity in the development-dependency closure. No
repository source, test, script, CI or deployed invocation of this Playwright
Client path has been established. Repository search finds only the direct-dev
declaration. Do not claim a deployed application exploit or derive production
reachability from the dependency's presence alone. Bundled legacy v3 constructors
are shipped but dormant in this carrier: the discovered aliases are declarations,
not demonstrated application consumers. Their correction closes shipped-copy
coverage; it is not evidence of another reachable application exploit.

## Reviewed mechanism proposed for acceptance

### R23: Prefer the genuine official same-major correction

Raise only the existing direct development Playwright floor from `^1.62.1` to
`^1.65.1`, locking official Playwright and playwright-core 1.65.1. The root package
depends exactly on core 1.65.1, and both declare Node >=20, compatible with this
repository's Node >=22.12 requirement. Registry metadata and both official tarballs
were fetched without installation and verified against their SHA-512 integrity.

Official 1.65.1 embeds Zod v4.6.7 with upstream `sizeCaps`/`capSize` interpreter
preflights for arrays, maps and sets, and actual generated compiler size gates.
Keep those upstream v4 implementation and compiler bytes unchanged. This replaces
the larger bespoke v4 backport candidate to 1.62.1. Do not upgrade unrelated
packages, remove Playwright, relabel a vulnerable carrier or infer a fix merely
from the version number/audit result.

The root index.js/index.mjs and core exports/engine remain compatible. Upstream
removes the root jsx-runtime export and optional fsevents dependency; no repository
consumer of either was found. Verify the resulting graph and actual module/API
controls. Browser-version changes remain unexercised because this frontier does
not install or launch browser binaries. Any observed repository consumer or API
incompatibility returns to review rather than adding an application workaround.

### R24: Patch only the remaining legacy copy in the official carrier

Playwright-core 1.65.1 still bundles unfixed v3 Array, Set and no-rest Tuple
implementations. Their mechanisms match 1.62.1 apart from bundler identifier
renames. Add one exact-version pnpm-native patch for
`playwright-core@1.65.1`, touching only these mechanisms in
`lib/utilsBundle.js`:

- Arrays exceeding declared `.max()` or exact `.length()` retain existing bound
  issue emission and return the existing `INVALID2` before child allocation,
  spread, parsing or later raw-input refinements. Preserve normal transforms,
  too-small behavior, paths, custom error maps and sync/async APIs.
- Sets exceeding `.max()` or exact `.size()` retain existing issues and abort
  before values enumeration/child parsing or later raw-input refinements.
- Tuples without a rest schema iterate only fixed declared indices, preserving
  the existing too_big issue and invalid-prefix issue aggregation. Rest tuples
  retain their original tail semantics. Keep async and valid tuple behavior.

Use the already accepted R17/R18 control-flow corrections with this bundle's
exact identifiers. Preserve every non-target byte, module label, license, export,
v4 schema/compiler, MCP protocol and unrelated generated implementation. No v4
tuple edit is needed: its shipped implementation already bounds fixed-prefix
work and visits the tail only when a rest schema exists.

Native hunks must apply reproducibly. Pure zero-context insertion application was
previously defective in pnpm; use anchored replacements as needed to reproduce
the reviewed intended bytes. Do not add whitespace-hook exclusions or bypass
package integrity/version binding.

### R25: Exercise the actual exported consumer and retain its calibration

Add a bounded regression using the actual carrier's exported `Client`, its real
`complete` method and an in-memory fake transport. Perform an ordinary local
initialize handshake using the protocol version requested by the Client, then
answer completion/complete with a valid short result and the oversized result.
Do not reconstruct the completion schema or substitute another installed Zod.

Record the 1.62.1 baseline trigger separately from source-hash/setup failures.
An array of only 101 entries is sufficient: a first-entry getter/counter proves
that original child work occurs. The target's actual Client must reject with
the structured too_big issue at `completion.values`, maximum 100, before reading
that entry, while preserving normal completion values/total/hasMore fields.
Bound request timers and close Client/transport in every success/failure path.
Do not use a remote MCP server, account, token, keyring or external model API.

### R26: Verify every representation and intentional upstream semantics

Use the actual exported v4 `z` API for ordinary parser controls and the shipped
v4 compiler for real generated-path controls. Require strict compilation to
avoid silent fallback, assert a generated parser/compiled clone is actually
used, and prove array/map/set bounds precede element/iterator work. Exercise
object JIT and jitless paths that dispatch into the same collection parsers.
Do not treat toggling jitless alone as proof of the separate compiler path.
The original 1.62.1 carrier has object JIT but no Zod compileFn module; the new
1.65.1 carrier has both, so inventory/test the actual selected representation.
The additional coreBundle ZodArray-name check is CLI metadata introspection,
not a second parser implementation.

A bounded executable-source signature sweep of both new official tarballs
covered 36 Playwright files / 4,817,084 bytes and 40 core files / 12,229,277
bytes; only core `lib/utilsBundle.js` matched the parser-constructor signatures.
This establishes the stated signature coverage, not absence of hidden, native
or obfuscated implementations. Do not broaden that evidence into an exhaustive
all-dependency security guarantee.

Preserve the upstream leading-size-check semantics: conditional `when` can
disable an otherwise violated bound; non-size checks terminate the leading
optimization frontier; overwrite-before-max can legitimately shrink oversized
raw input; max-before-overwrite aborts before later raw refinements. Violated
leading bounds are selected in declaration order, retaining maximum/exact/origin,
custom messages, nested paths and the target's original error finalizer. Retain
skipChecks and backward/encode/canary order. Do not transplant a newer issue
schema field or alter error-finalization behavior into another representation.

Raw map/set bounds can reject before child transforms deduplicate keys/elements;
that is the upstream security invariant, not a promised continuation of the old
parse-before-bound behavior. Include valid-size transforms and unconstrained,
too-small and malformed-type controls alongside sync/async positives. Compare
structured issues where meaningful without demanding identical hardened errors
from different upstream v4 versions.

For dormant v3, an extracted unchanged factory from the exact shipped bundle is
permitted when no public constructor is exported. Bind extraction to the original
and target whole-file identities and assert factory boundaries uniquely; do not
test another package copy. Exercise declared max/exact array/set aborts before
callbacks/enumeration/refinements, normal and unconstrained transformations,
error metadata, async behavior, fixed-prefix aggregation and rest tuples.

### R27: Compatibility, graph and fresh installation evidence

Verify actual root package import, CLI help/version and the existing public
browser-type exports without installing or launching browsers. Exercise the
real Playwright request API against a bounded ephemeral loopback HTTP fixture,
including a normal response and disposal. Use only the task's external temporary
storage; no shared browser/client caches, HOME redirection, authentication,
global updates or package lifecycle-permission changes are authorized.

Require a fresh frozen installation with official whole-package integrity and
all native patch identities checked. Verify the new patched bundle against the
intended source SHA-256, ensure non-target v4/bundle bytes remain unchanged, and
reconfirm all prior native Zod/markdownlint import/parser patches. Inspect all
graph churn: only the two official Playwright releases, their required metadata
and removal of the no-longer-required optional dependency are permitted. Keep
the existing complete unfiltered audit and all security checks enabled.

### R28: Preserve prior fixes and verify the final immutable head

Retain all behavior and authority boundaries of 735b202. Do not edit application
or UI source, reporter/policy/evaluator/writer mechanisms, exception or secret
baselines, allowlists, required checks, settings or credentials. No browser
installation, shared-cache bootstrap, merge, auto-merge, push or deployment is
authorized. Public hash detector classifications remain visible; do not hide
integrity pins to make the extra manual detector green. Live Mintlify route
coverage remains unavailable under the already recorded boundary.

After focused improvement and native-patch inspection, commit a reviewable local
candidate. Previous full checks establish only 735b202; the corrected final head
requires frozen install/audit, full application/docs/type/style/test checks,
existing Node/Python evidence contracts, required pre-commit and workflow audits,
redacted Gitleaks, unsigned publish-never desktop packaging and independent
reviewer recheck. Retain receipts outside the worktree. Parent owns publication
and trusted hosted CI follow-through; a successful local process is not delivery.

## Exact original identities

| Artifact | SHA-256 |
| --- | --- |
| Installed core 1.62.1 `lib/utilsBundle.js` | `580f571bf063e2256b51b3946a035bc452fc0e22808d5547b198baea39923a32` |
| Official core 1.65.1 `lib/utilsBundle.js`, before v3 patch | `897440163be29ea4c73c6203ce2fc244aebb2916839d37b8591a94b72d929a0a` |
| Official playwright 1.65.1 tarball | `e2ebec5abb40f511c7a4442e83042fd8a4e654c3367e120b76e94a61a8f91e01` |
| Official playwright-core 1.65.1 tarball | `6f5a60be62a4fddfbe7d10c448d8fbd54547da3358f2f8a04211440471ee863e` |

Primary release metadata: [playwright 1.65.1](https://registry.npmjs.org/playwright/1.65.1)
and [playwright-core 1.65.1](https://registry.npmjs.org/playwright-core/1.65.1).
The declared-bound invariant follows the official
[Zod correction](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd).

## Owned paths and acceptance matrix

Only these paths may change after reviewed acceptance:

- `package.json`: Playwright floor and exact native patchedDependency entry only.
- `pnpm-lock.yaml`: package-manager-generated required resolution/patch metadata.
- `patches/playwright-core@1.65.1.patch`: the single v3 carrier correction above.
- `test/dependency-playwright-zod-security.test.ts`: focused security and actual
  consumer/API compatibility controls.
- This specification, `wiki/frontiers.md`, the existing PR78 working record and
  one relevant run record.

| Requirements | Required evidence |
| --- | --- |
| R23/R27 | Verified official tarballs/engine/exports, complete graph diff, real root CLI/import/request positives and fresh frozen installation. |
| R24/R26 | All native hunks preserve non-target bytes; v3 baseline counters become zero, valid/error/async/fixed/rest semantics pass and exact installed whole-file identity matches intended bytes. |
| R25 | Actual old Client completion reaches child sentinel; actual target Client rejects declared maximum before child access and preserves normal completion response. |
| R26 | Real public v4 parser/object-JIT/jitless/strict compiler controls pass with active/disabled bounds, ordering, overwrite, transform, backward/skipChecks and structured errors. |
| R28 | Prior controls unchanged; exact final-head full checks and reviewer recheck, accurate remaining coverage limits, no external publication or authority expansion. |

## Failure and handoff

A missed carrier, unexplained consumer change, incompatible package export,
unexpected graph churn, failed patch identity or validation failure returns to
mechanism review. Do not suppress a finding or widen a patch silently. Spec
preparation and read-only research may continue before acceptance; dependent
manifest, lock, patch or test edits wait for reviewed acceptance recorded and
committed first. This proposal hands auto-pm back to the delegated project lead.

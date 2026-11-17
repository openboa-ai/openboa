# PR-security-dependencies-20261117

- `Title`: Remediate compatible dependency security alerts
- `Branch`: `codex/security-dependencies-20261117`
- `Goal`: Remove all 38 original dependency alert entries, all four subsequent registry advisories, the expired reporter exception and 17 baseline whitespace failures through verified fixes in the same draft PR78.
- `Metric`: 38 targeted alert entries (34 unique GHSAs) absent from the resulting graph; no existing product, packaging or security regression.
- `Quality target`: Existing behavior and controls pass unchanged; no dismissed alerts or unverifiable fix claims.
- `Owned boundary`: Dependency [spec revision 6](../../docs/engineering/security-dependencies-20261117/spec.md), separate accepted [reporter revision 7.1](../../docs/engineering/security-dependencies-20261117-reporter/spec.md), their enumerated paths and this frontier's wiki records.
- `Acceptance criteria`: Requirement-linked evidence in the specification, independent immutable-diff review, and exact-commit trusted CI; draft PR only.
- `Current status`: `open`
- `Current owner`: `auto-coding`
- `Accepted specification`: Revision 4, SHA-256 `1468eb7b83292ec952bdedcf990fe55a41c67228b5a309dbf6a4c1fe0b4a213a`, accepted by the delegated project lead after independently confirmed consumer regression review; recorded at 2026-11-17T10:59:02+00:00. This is routine lead acceptance, not new human approval. Earlier accepted revisions are recorded in `cdb463c2e7f8a955deccda85f46523fb72fc310e`, `b7fe181` and `bcc6ba5`; revision 4 is committed before the lasting CLI2 compatibility control.
- `Baseline`: 38 open Dependabot alert entries (34 unique GHSAs; 1 critical, 14 high, 15 medium, 8 low); readable code scanning and secret scanning each return zero open alerts.
- `Current quality gap`: Follow-up dependency and reporter focused controls pass; the unsuppressed audit and policy check both pass. Complete exact-head verification, desktop packaging, fresh independent review and trusted hosted CI remain pending on the final candidate.
- `Latest winning run`: `RUN-20261117-security-dependencies-remediation`; actual final focused set passes 16 tests / 4 files, and all original alert GHSAs are absent from the candidate audit.
- `Latest failed run`: Smol-toml 1.9.0 candidate fails the actual CLI2 inline TOML per-rule option control; this dependency change was discarded.
- `Why this PR is not ready yet`: The final follow-up candidate still requires complete exact-head checks, independent review and trusted hosted CI. Focused working-tree results are not exact-commit CI evidence.
- `Open risks`: Native third-party compatibility patches require reviewed upstream maintenance and complete fresh-install/bundle coverage. The pre-existing get-uri download rejection path can produce an empty stream and unhandled rejection; no application/consumer shim is included. Actual reporter operation remains unobserved before a separately authorized merge. Clean audit/scan results do not prove absence of vulnerabilities outside their coverage.
- `Next action`: Hold the committed candidate immutable during full verification and one fresh independent review; the delegated delivery owner handles publication/CI. Merge and deployment remain prohibited.


## Follow-up proposal for PR78

The user requests continued work in the same draft PR to remove all four remaining
audit GHSAs, the expired exception and 17 baseline whitespace failures with real
fixes. Specification revision 5 proposes scoped minimatch/KaTeX updates, a native
pnpm markdownlint compatibility patch with the fixed TOML parser, and the exact
17 whitespace paths. Zod and reporter mechanisms remain explicitly gated for a
later reviewed revision. Implementation remains at b972948 until reviewed
acceptance; only read-only investigation and specification preparation have run.


Revision 5 R11-R15 was accepted by the delegated project lead at
2026-11-17T11:45:53Z after reviewing content SHA-256
`04a066f3dc24251850d79a58029c5248342c22ac24b693dc8369af41abedc137`.
The source status now records that acceptance; its source commit precedes all
follow-up dependency, patch, test, workspace metadata and whitespace edits.
This hands one bounded implementation run from auto-pm to auto-coding. Zod and
reporter changes remain gated and are not implementation authority in revision 5.


The accepted revision 5 iteration is kept in
`RUN-20261117-security-dependencies-followup`: three remaining dependency fixes
and all 17 exact whitespace/EOF edits are complete. The 26 focused consumer/TOML
checks and full pre-commit profile pass without additional edits. Unsuppressed
audit now reports only Zod GHSA-mrhx-c7xc-m3w5. Zod and the expired reporter
mechanism remain open, and require their own accepted specification before edits.


Proposed revision 6 defines a real Zod4.6.6/v3 multi-entrypoint remediation with
native parser backports in every executable representation, literal legacy import
migration and the official compatible JSON Schema converter update. No Zod or
reporter dependent edit has started. The reporter remains a separate proposed
mechanism, so its review cannot silently widen the accepted Zod boundary.


Revision 6 R16-R22 was accepted by the delegated lead at 2026-11-17T12:09:25Z,
reviewed proposal SHA-256
`5cf09ad1c08bde3bdff6bdfd182b51d34fc722222e0b3bd705a37586d7701775`.
The acceptance/source commit precedes every Zod-dependent edit. Only editorial
status fields and the stale introductory gate sentence were reconciled after
acceptance. Reporter revision 7 is proposed separately at
`docs/engineering/security-dependencies-20261117-reporter/spec.md`, preserving
this accepted Zod source while that independent mechanism is reviewed.

Revision 6 is kept in `RUN-20261117-security-zod`: all five parser/bundle copies
and all 211 import/type files reproduce reviewed bytes in a fresh frozen install;
48 Zod behavioral controls pass and unfiltered audit exits 0 at every severity.
Pure insertion patch application was corrected with anchored replacement hunks
before keep, without changing intended source or excluding hooks. The independently
accepted reporter revision 7.1 is recorded in `4586036` and implementation now
passes from auto-pm to the same auto-coding writer. Its policy replacement, full
exact-head checks, desktop packaging and independent final review remain open.

The accepted reporter 7.1 iteration is kept in
`RUN-20261117-security-reporter`. The real trigger replacement, shared bounded
budget and current-round publication controls pass focused evidence tests; the
obsolete exception is removed and policy validation passes without a renewal.
The candidate is now frozen for full exact-head verification and independent review.
Earlier failed/kept iterations above remain historical evidence, not current blockers.

Independent review of unpublished 735b202 found another shipped Zod carrier in
direct development Playwright. Actual exported Client.complete response parsing
uses a declared max(100) array before the old bundled v4 enforces its bound.
Severity is medium in the development closure; no repository/deployed invocation
is established. The original v3 constructors are dormant shipped copies.

Auto-pm proposes separate revision 8: official same-major Playwright/core 1.65.1
already supplies fixed v4.6.7 interpreter/compiler behavior, with a single native
v3-only carrier patch for the remaining original array/set/tuple mechanisms.
Exact source identities, compatibility caveats and actual consumer/fresh-install
evidence are defined in its specification. No implementation has started; 735b202
receipts remain valid for that exact head, and publication stays paused until
reviewed scope acceptance, correction, final-head verification and reviewer recheck.

Revision 8 R23-R28 was accepted by the delegated lead at 2026-11-17T13:32:03Z,
exact proposal SHA-256
`0b285df5bbc78f265b49acde9dc640ab3bcada977fc13a76d8694ba02ad1d314`.
The acceptance/source commit precedes all dependent edits and hands auto-pm to
the sole auto-coding writer. Only the paired official update and v3-only carrier
patch are authorized; existing controls and the no-publication boundary remain.

# Read-only merge canary

The canary reports whether the current evidence satisfies the reviewed policy.
It has no merge API call, merge job, write token, activation input, PR comment,
post-merge dispatch, or success receipt for a merge that has not happened.
`mode: report-only` is stored with the policy. A positive result is conditional
eligibility, never approval or authorization to merge. Actual unattended merging
requires separate approval and a concrete, reviewed merger implementation;
changing this mode field alone cannot enable it.

The first eligibility scope is an exact `README.md` change in this public
repository. Every other tree path, mode and blob must be unchanged. This is the
bounded initial pilot, not a classification that all other future work must
remain manual. Changes to workflows, scripts, dependencies or application code
are ineligible for this policy. In particular, the PR adding this infrastructure
cannot qualify itself.

## Reviewed trigger exception

The single inline `dangerous-triggers` exception on this reporter's `on:` line
was explicitly approved for this read-only data flow. It acknowledges Zizmor's
[broad workflow_run warning](https://docs.zizmor.sh/audits/#dangerous-triggers),
not a blanket claim that this trigger is safe. The original unmodified warning
was observed on draft PR67 at commit `4e11cbe397edddbff0ab41f0e3a68d9ce2c39c75`.
No other audit, severity threshold, workflow or scanner is excluded.
The existing CI exception policy records owner `@SonSangjoon`, PR67 and an
expiry of 2026-10-14 in `.github/ci-exceptions.json`; expiry fails the policy gate.

Only the immutable default-branch workflow revision and the exact reviewed
central evaluator SHA/digest execute. Permissions are read-only, checkout
credentials are not persisted, and there is no candidate checkout, candidate
execution, cache, untrusted expression in a command/environment, or write job.
Bounded strict JSON/ZIP parsing and deny-on-missing-proof rules still apply.
Regression tests pin the reviewed workflow bytes and reject boundary mutations;
they are a trusted-source regression tripwire, not an exhaustive malicious-YAML
security parser. Any future write/merge
authority, new executable source, cache or event-data execution requires a new
security review; this exception does not authorize it.

The exact CLI policy is `2.27.1`, verified from hosted raw SARIF in PR67's
reusable-validation run `36720718062`. The pinned action's declared default was
`2.26.2`; actual runner resolution selected `2.27.1`. Future version drift denies
eligibility until a reviewed explicit policy refresh, rather than accepting a
version range automatically.

## Evidence and trust

The collector reads GitHub through bounded authenticated GET requests. It runs
only the controller revision and its pinned evaluator, never candidate code.
The workflow event is a wake-up hint: current repository, PR, base/head, complete
diff/tree, exact workflow IDs, run attempts, jobs, steps, protection rules and
artifacts must be collected and reconciled. Missing, stale, conflicting,
unreadable or over-budget observations deny eligibility.

CI scope and PR convention upload an inline source receipt before executing
repository code. Each CodeQL language job also records its actual checkout,
parents, workflow source digest and tracked source-file inventory before
scanning. CodeQL runs in `build-mode: none` without installing dependencies or
running repository build scripts; the ordinary functional CI and native build
remain required. TypeScript is tracked source; the removed scanner build only
transpiled it into `dist`. All three languages and the `security-and-quality`
query suite remain enabled. The tracked inventory identifies expected source
objects; it does not attest which files the extractor analyzed. Hosted analysis
logs and raw SARIF coverage still need inspection.

The raw CodeQL SARIF and source receipt use a unique run/attempt/language artifact
name. The collector verifies the platform archive digest, exact members, source
objects, workflow closure, expected producer job/upload step and their times.
This is correlation under the reviewed trusted-writer model. GitHub artifacts
do **not** provide native cryptographic producing-job or attempt attestation;
receipt claims alone are insufficient. Artifact data is parsed without
extraction or execution. A zero-result SARIF file describes that analysis and
its coverage, which may be diff-informed; it is not a whole-source security
audit or proof that vulnerabilities cannot exist.

## Reusable validation

CI, dependency audit and CodeQL accept a full immutable source SHA. CI's explicit
`full_scope` mode runs the real docs, code, dependency, secret, policy and native
packaging lanes. Its aggregate still rejects missing, skipped or failed required
lanes. CodeQL's explicit analysis ref/SHA pair prevents a future caller's event
context from accidentally labeling a different source revision.

Local reusable workflow definitions come from the caller's workflow commit,
while checkouts use the requested source SHA. A future merge controller must
verify that control closure and pass the actual returned merge commit. No such
merge or post-merge continuation is performed by this report-only controller.
In particular, a `GITHUB_TOKEN` merge must not rely on an ordinary push workflow
being triggered. The callable CodeQL ref input is syntax-checked, not an API
proof that a branch points to the requested commit. A future upload-enabled
caller must establish that relationship before calling it.

The path-filtered `reusable-validation` workflow deliberately runs an additional
full CI/native build and three genuine CodeQL analyses when reusable plumbing
changes. Its separate workflow name isolates cancellation from ordinary CI.
Its CodeQL analyses use a distinct category and disable upload, preserving the
normal authoritative analyses. They still must produce valid SARIF. The harness checks basic output structure;
the collector and evaluator enforce the full provenance, invocation, findings
and coverage-related evidence contract. This adds
runner time on infrastructure changes and makes the prospective call contract
observable. It is not evidence that a post-merge run occurred.

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

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

When a successful first-attempt job's list response has incomplete policy-required
steps, the collector makes one direct job GET. It accepts the complete replacement
only after reconciling job ID, run, attempt, head, name, start/end times and terminal
outcome. Existing terminal step contradictions or duplicate identities deny;
fragments are never combined. List and direct request digests are retained.
This single bounded refresh is the eventual-consistency retry. If it is still
incomplete, eligibility remains blocked. Unfinished post-cleanup steps outside
the required policy do not cause a refresh or weaken required-step checks.

Every applicable active ruleset must explicitly report
`current_user_can_bypass: never` in unchanged initial and final authenticated GETs.
The same collector client retains the same credential throughout. This proves
only the current report-only request credential's bypass status; it does not
assert that the global bypass actor list is empty, and no token value or fingerprint
is recorded. Any future writer must recollect with its actual action credential;
this report cannot be transferred to a different token or authorize a merge.

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

## Default-OFF README writer proposal

`readme-writer-pilot.yml` is a separate, inactive event-driven writer proposal.
The tracked pilot policy has `enabled: false`; the writer job additionally requires
`OPENBOA_README_WRITER_ENABLED == true`. This change creates neither that variable
nor a live permission grant. Its new trigger warning is deliberately unsuppressed;
the earlier read-only exception does not apply to this workflow. Landing, any
exception, enabling the policy/variable, and actually merging require separate
approval. The read-only reporter remains independent.

The only durable target is PR68 and the exact regular README blob transition
`1f91d44dbd4482ec7f4c63816871c749dd3620ac` to
`69e48877815a57cb5acbf5497663381010a3b3db` (`docs` to `documentation`). Every other
file must remain unchanged. The controller derives fresh base/head SHAs from the
API and requires the base to equal its trusted default workflow revision; it never
pins a stale approval to a later head. It collects all evidence itself using the
same captured token later used for one normal expected-head squash merge request.
The unchanged evaluator's report-only result supplies evidence, not authority.
No uploaded/cached report authorizes this writer.

Up to three independent collections can wait for the observed completed-success
job-step metadata lag. Each wait is at most 240 seconds and shortens to retain
120 seconds for the next collection plus a 60-second merge/reconciliation reserve;
less than 30 seconds of available delay denies. They share a 600-second, 300-request
and 75-MiB compressed/JSON byte ceiling; each collection phase retains a 120-second
and 100-request cap. No records are combined, no producer is rerun, and negative,
changed or still-unavailable evidence denies. All non-step facts, artifact/raw
digests and already-terminal steps remain bound across collections; later success
cannot erase an earlier negative. Each original observation/report is retained.
These bounds do not guarantee API convergence. The sole PUT is never retried, even after an ambiguous response.
Read-only reconciliation verifies the actual merged SHA, its parent and exact tree;
an unresolved outcome is `merge-unknown`, never a success receipt.

GitHub's expected SHA guards the PR head, not the base atomically. The writer relies
on unchanged strict server protection, immediate base/rules rereads and owner
stability; it cannot promise an atomic expected-base operation that the API lacks.
The policy and own workflow active state are reread before PUT. The variable is a
job-start gate, not an instantaneous in-flight kill switch. Disabling the workflow
or cancelling a run cannot recall an already transmitted merge request. An operator
must reconcile a crash between the request and persisted outcome read-only.

The full workflow is serialized with cancellation disabled. GitHub's default queue
still replaces a pending run with a newer wake-up; this is not a lossless queue.
The current pinned actionlint rejects the new `queue: max` syntax, so this draft
retains the existing syntax and documents operator recovery: after separate
activation approval, a missed wake-up requires an explicitly authorized rerun
that recollects fresh evidence. No rerun or activation happens in this proposal.
A verified returned
merge SHA drives actual reusable full CI and all three CodeQL languages, without
`actions: write`, dispatch or deployment. Strict raw gates require zero results,
successful invocations, no warning/error notifications, exact source receipt/caller
bindings and nonempty tracked-language extraction. They do not attest complete
source coverage. Caller workflow/event identity remains truthful, distinct from
the merged checkout SHA; no standalone push/native Code Quality run is fabricated.
An always-running aggregate reports merged-but-validation-failed on any failed,
skipped or unavailable continuation. It does not revert automatically. Manual run
cancellation can still interrupt continuation and requires operator follow-through.

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

CI, dependency audit and CodeQL check out the immutable server event SHA
(`github.sha`). Reusable callers cannot select a different source revision.
CI's explicit `full_scope` runs the real docs, code, dependency, secret, policy
and native packaging lanes. Its aggregate rejects missing, skipped or failed
required lanes. Checkout credentials are not persisted. The dependency audit
uses a frozen install without lifecycle scripts and no dependency cache.

The path-filtered `reusable-validation` workflow runs an additional full CI/native
build and three genuine CodeQL analyses when reusable plumbing changes. Both
calls retain the PR event's merge SHA. CodeQL's positive `isolated_analysis: true`
flag selects a distinct category and disables upload; an absent input on normal
push, PR, schedule or manual runs preserves production categories and uploads.
The harness still validates actual SARIF structure. The collector/evaluator
and strict postmerge validator enforce their additional evidence contracts.
No passing result is fabricated for a skipped scan.

## Default-OFF README writer proposal

`readme-writer-pilot.yml` polls only the trusted default branch every 15 minutes
at minutes 7, 22, 37 and 52, with an input-free manual trigger for owner recovery.
Scheduling can be delayed by GitHub. This deliberately removes the privileged
PR-completion listener; it does not suppress its former scanner findings.
The existing read-only reporter and its separately approved exception are unchanged.

The variable `OPENBOA_README_WRITER_ENABLED == true` is required before even the
read-only preparation job checks out code. The tracked policy additionally has
`enabled: false`. Both gates remain OFF; this patch creates no variable and
activates no writer. Scheduled runs can therefore exist with all jobs skipped.
Landing this correction does not authorize activation or merging the canary.

The only durable merge target is PR68 and the exact regular README blob transition
`1f91d44dbd4482ec7f4c63816871c749dd3620ac` to
`69e48877815a57cb5acbf5497663381010a3b3db` (`docs` to `documentation`). Every other
file must remain unchanged. The controller derives fresh base/head SHAs from the
API and requires the base to equal its trusted default workflow revision. It
collects all evidence using the same captured token later used for one ordinary
expected-head squash merge. The collector's fixed-pilot mode records the actual
schedule/manual event and selects PR68 through the API, never a fabricated
`workflow_run` event. All run/source, rules/current-principal, strict-base, raw
scanner and freshness checks remain mandatory. A prior report is never authority.

Up to three independent collections can wait for the observed completed-success
job-step metadata lag. Each wait is at most 240 seconds and shortens to reserve
120 seconds for collection plus 60 seconds for merge/reconciliation; less than
30 seconds of available delay denies. They share a 600-second, 300-request and
75-MiB compressed/JSON ceiling; each phase retains 120-second and 100-request caps.
No records are combined, no producer is rerun, and negative or changed evidence
denies. All non-step facts, artifact/raw digests and terminal steps stay bound
across collections. These bounds do not guarantee API convergence.

The sole merge PUT is never retried, even after an ambiguous response. Read-only
reconciliation verifies the actual merged SHA, its parent and exact tree;
an unresolved outcome remains `merge-unknown`. GitHub's expected SHA guards the
PR head, not the base atomically. Unchanged strict server protection, immediate
rereads and trusted-owner policy stability remain necessary assumptions. This
Free design does not enforce policy against a malicious same-repo writer.
The variable is a job-start gate, not an instantaneous in-flight kill switch.
Disabling/cancelling cannot recall a transmitted request. An operator must
reconcile a crash between the request and persisted outcome read-only.

## Separate postmerge verification

After a confirmed merge, an isolated trusted dispatcher receives that SHA. Only
this job proposes `contents: read` and `actions: write`; the merge job retains
`contents: write` and its existing read permissions. Actions write is a
repository-wide workflow-control capability, even though this code sends exactly
one fixed dispatch endpoint, workflow filename and `main` ref. The owner approved
this additional capability; it is never passed to test or scanner runners.

The dispatcher confirms the returned merge commit's parent is its own trusted
controller SHA and main still points to it. It then calls the fixed
`postmerge-verification.yml` using API version `2026-03-10`, which returns an
explicit run ID and URLs. It validates that response and never retries the POST.
A missing or ambiguous response is unconfirmed, not a reason to create another
run. Logs retain bounded response digests and run identity, never credentials.

Before any checkout or reusable job, the target requires its actual server event,
workflow SHA and expected commit to agree on `refs/heads/main` in this repository.
The supplied expected SHA is a comparison value; it cannot choose code to run.
If main races before dispatch resolves, the target fails before execution.
If the event already captured the confirmed SHA and main later advances, testing
the captured SHA remains valid; the report does not claim it is still latest main.
An authorized standalone manual verification reports only that it verified the
specified main commit. It does not claim a writer merge occurred.

Separate full CI and all three CodeQL languages run with their existing read
permissions and the existing scanner-only `security-events: write`; no secrets,
merge token, Actions write or deployment capability is inherited. Strict raw
gates require zero results, successful invocations, no warning/error notices,
exact same-job source receipts and nonempty tracked-language extraction. They do
not prove complete coverage. Failed strict gates retain prepared raw artifacts
and still fail the final always-running aggregate.

The dispatcher observes only its returned run ID: exact repository, workflow,
event, main branch, commit and first attempt remain bound. Success additionally
requires all 14 known verification jobs to succeed, including the source guard,
full CI aggregate, three language lanes and final aggregate. Completed-success
job-list metadata can receive two 15-second read-only refreshes; terminal
contradictions never become success. A run is polled at most 101 times, 30 seconds
apart, under 150-request, 3100-second and 10-MiB JSON bounds. Failure, cancellation,
missing proof or timeout remains unconfirmed. There is no rerun or blanket retry.

The writer workflow serializes merge, dispatch and observation without cancelling
an active run. Scheduled pending runs may coalesce; the next scheduled poll
recollects fresh evidence. A confirmed merge with failed verification is reported
as merged-but-validation-failed, never unmerged or green. No automatic revert is
performed. Recovery is a separately authorized owner investigation or exact-main
read-only verification; no permission escalation, exception or alert dismissal
is built in.

Official semantics: [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
[workflow events and schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

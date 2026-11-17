# Trusted-main read-only reporter replacement specification

- Revision: `7-reporter`
- Status: `accepted; implementation follows accepted Zod revision 6`
- Reviewed proposal SHA-256: `ae1e93f97d5c0a84b74a38307a823f63393e6ab0c83a611e5423c139e0e486a3`
- Acceptance: delegated project lead, `2026-11-17T12:17:03Z`; no settings, writer activation, merge, auto-merge or deployment authority
- Date: `2026-11-17`
- Repository: `openboa-ai/openboa`
- Delivery: continue draft PR78; merge, auto-merge and deployment remain prohibited
- Baseline: reporter/policy behavior at `8e951d8`; dependency revision 6 is separate

## Intent and authority

The user requests a real replacement for the expired read-only workflow_run
exception, preserving all checks rather than extending an exception or disabling
a scanner. Replace only the reporter's trigger/selection/lifecycle mechanism with
trusted-main schedule and inputless manual polling. Reports remain advisory,
partial and read-only. An eligible verdict never authorizes a merge.

No new credential, secret, repository permission, cache, candidate execution,
PR comment, dispatch, write API, writer activation or release is permitted.
The current evaluator revision and digest, README-only policy scope, evidence and
protection checks, writer OFF gates and fixed PR68 target remain authoritative.

## Concrete mechanism

- P1: Replace `.github/workflows/merge-canary.yml` workflow_run with an off-hour
  15-minute schedule, `7,22,37,52 * * * *`, and inputless workflow_dispatch.
  Gate the report job on the default main ref and approved event names. Keep
  read-only contents/actions/checks/pull-requests permissions, immutable controller
  checkout at github.workflow_sha, pinned evaluator SHA/digest, setup pins,
  persist-credentials:false, no cache and bounded existing artifact retention.
  Use one fixed concurrency group with cancel-in-progress:false; do not allow
  overlapping reporter rounds to expand resources or cancel a running round.
- P2: Add `scripts/run-merge-canary.py`. Before any API operation, validate strict
  policy mode report-only, exact repository name/ID, real schedule or inputless
  manual context, refs/heads/main, immutable valid workflow/event SHAs and actual
  clean committed controller checkout. Reject foreign identity, stale controller,
  branch-selected manual execution, malformed IDs and supplied inputs. Reconcile
  current API main before selecting a PR; missing or changed facts deny eligibility.
- P3: Discover open same-repository PRs against main through bounded authenticated
  GET pagination only. Exclude fork/head-repository mismatches and invalid targets;
  never execute or interpolate PR titles, bodies, paths or source. Sort eligible
  numeric PR identities deterministically and select exactly one using the
  trusted positive workflow run number modulo the stable ordered list length.
  Empty, invalid or incomplete discovery has an explicit non-positive outcome.
  No state cache, random cursor, external schedule service or new webhook exists.
- P4: Summaries distinguish discovered, selected, deferred and excluded counts and
  numeric identities/reasons, with `coverage: partial` when any eligible PR was not
  processed. Unprocessed PRs receive no positive verdict. Rotation under a stable
  N-PR list needs up to N successful consecutive polling rounds; failed, skipped
  or cancelled queued rounds, GitHub scheduling delay and list changes can extend
  that time. Do not promise a 15-minute all-PR SLA or imply
  the organization/repository is wholly green from one report.
- P5: Extend collector `collect` only with mutually exclusive keyword-only
  `report_number`; retain all existing default and fixed-pilot68 behavior.
  The new selection requires report-only policy, exact same-repository main
  schedule/inputless-manual context and a positive integer excluding bool.
  Fetch/reconcile the selected PR through the API and feed the existing collector
  and evaluator unchanged. Do not fabricate a workflow_run event, forge producer
  receipt fields or weaken any run, source-tree, control-closure, rules, principal,
  artifact, SARIF, freshness, strict-base, version or current-principal bypass gate.
- P6: Add a reporter-only API/budget adapter, leaving GitHubGet and WriterAPI's
  existing methods/counter semantics unchanged. One aggregate budget covers
  discovery and the selected PR: at most 100 GET requests, a 25 MiB acceptance
  limit for total JSON plus compressed ZIP response-body bytes, 100 MiB aggregate reserved expanded ZIP
  bytes, and 120 seconds for the complete round. Every actual opener request and
  response read is charged; check the deadline before both artifact GET hops,
  before reads and after reads. Clamp network timeouts and requested read sizes
  to remaining budget; excess or missing accounting blocks the report. If one
  bounded sentinel byte is read beyond the 25 MiB acceptance limit to detect
  overflow, charge it to actual consumed bytes and reject immediately. Do not
  describe that over-cap transfer as within a strict 25 MiB transport bound,
  perform another read, or emit positive eligibility after the sentinel.
- P7: Before passing any downloaded ZIP to existing member decompression, inspect
  its central-directory metadata without extraction and reserve all nonnegative
  declared expanded sizes against the aggregate expanded budget. Retain all
  existing exact-member, path/mode, duplicate, encryption, digest, JSON/SARIF and
  producer checks. Do not decompress first and then discover an exceeded budget.
  Signed download requests retain no Authorization header; do not serialize
  tokens, fingerprints or signed URLs. Preserve original no-redirect/origin gates.
- P8: Enforce the round deadline with an outer watchdog that owns only the fixed
  reporter worker/process group. It terminates its own timed-out collection or
  evaluator subprocess and emits a blocked/failed partial summary; it never kills
  unrelated processes. Pass remaining time to fixed evaluator subprocess calls.
  Cooperative deadline checks alone must not be described as a hard 120-second
  limit over decompression, parsing and child evaluation.
- P9: Create a fresh empty run-specific output root exclusively, or reject any
  preexisting target before collection/evaluation. Bind parent/worker messages and
  every published observation/report/summary to the current round identity
  (repository, run ID, attempt, controller revision and fresh round identity).
  Never reuse a prior positive file from an existing root. Publish completed files
  atomically from current-round staging; failed or timed-out rounds remove only
  their own unfinished staging and emit a current non-positive summary. A worker
  or evaluator failure cannot surface old output as current evidence.
  Store only fixed filenames under that trusted output root and a canonical
  positive-numeric selected-PR directory. Reject symlink/nonregular or escaping
  output targets. Invoke the existing Node evaluator with a fixed argument array,
  exact committed policy and pinned evaluator module. Strip GITHUB_TOKEN from the
  child environment; the old evaluator had no such credential. PR data never
  becomes code, shell input, module path, output path or executable source.
- P10: Add the runner to policy controlPaths, without changing report-only mode,
  evaluator identity, README allowlist, check identities or eligibility gates.
  Keep `.github/readme-writer-policy.json`, writer workflow and fixed PR68 behavior
  unchanged. Existing collector/default and pilot68 tests remain meaningful and
  pass alongside the new report_number selection tests.
- P11: Remove only the obsolete reporter dangerous-triggers ignore and the
  `merge-canary-read-only-workflow-run` entry in `.github/ci-exceptions.json`
  after the real replacement and required boundary tests pass. Preserve SLA and
  all unrelated exception/policy records. No renewal, backdated expiry, new
  suppression, scanner severity change or permissive evaluator edit is allowed.
- P12: Run the new runner tests in both reporter trusted-boundary validation and
  reusable-validation's existing evidence-contract lane. Update its affected path
  filter only to cover the new runner/tests and this real workflow plumbing.
  Retain immutable checkouts and every current workflow language/CI/native lane.
  Update exact execution-boundary tests to the replacement while retaining their
  malicious permission/cache/candidate execution/untrusted-input mutations.

## Owned files

- `.github/workflows/merge-canary.yml`
- `scripts/run-merge-canary.py`
- `scripts/collect-merge-evidence.py` (new selection argument/branch only)
- `.github/merge-canary-policy.json` (runner controlPath only)
- `.github/ci-exceptions.json` (obsolete reporter entry only)
- `.github/MERGE_CANARY.md` (real trigger, rotation, coverage, resource and trust facts)
- `.github/workflows/reusable-validation.yml` (new runner tests/path coverage only)
- `test/test_run_merge_canary.py`
- `test/test_collect_merge_evidence.py`
- `test/merge-canary-adapter.test.mjs`
- `test/reusable-workflows.test.ts` if required to preserve the existing lane contract
- This specification and the existing frontier/run memory for PR78

No dependency/app/Zod changes are part of this reporter mechanism. The central
reviewed evaluator, default GitHubGet/WriterAPI behavior, writer policy/workflow,
postmerge dispatcher/validator, required checks and repository settings remain
outside its mutation boundary.

## Requirement-linked acceptance evidence

| Requirement | Evidence |
| --- | --- |
| P1-P2 | Positive schedule/main and inputless-main manual controls; before-API denial for branch manual, inputs, wrong repository/ID, stale/mismatched checkout and bad policy mode; exact workflow execution-boundary mutations and no dangerous-trigger ignore. |
| P3-P5 | Shuffled complete pagination produces stable one-target rotation; valid numbers only; foreign forks, non-main/closed/malformed PRs excluded or denied; duplicate/incomplete discovery cannot yield coverage/eligibility claims; default and fixed68 collector tests unchanged in meaning. |
| P6-P8 | Fake-clock/opener controls charge discovery+JSON+both ZIP hops, combined bytes and request boundaries; aggregate expanded-size denial precedes decompression; timeout/read-overrun and stalled worker/evaluator controls produce non-positive bounded outcomes without leaked processes. |
| P5/P9-P10 | Real pinned evaluator adapter still rejects missing/stale/raw-proof defects; fixed argv/numeric paths and token-absent child environment controls; existing positive output, wrong-round handoff, worker/evaluator failure and timeout cannot expose a stale positive as current; atomic completed-file publication; all original protection, bypass and source/evaluator closure requirements retain their values. |
| P11-P12 | Policy check passes without any expired-entry extension; actionlint/zizmor pass without suppression; new Python tests run in both required trusted-boundary/evidence-contract lanes; fixed68 writer-OFF negative controls and existing tests pass. |
| All | Frozen exact commit, full application/docs/security/pre-commit/native packaging checks, complete CI and one fresh independent immutable-diff review. No automatic merge/deploy or claim of actual operation until separately observed. |

## Failure and recovery

An API error, incomplete page, changed main/head, exhausted budget, malformed ZIP,
missing proof, evaluator failure or timeout remains blocked/failed. Do not retry a
mutation: this runner has none. A later scheduled round recollects fresh evidence
under a fresh bounded budget; never combine partial records from different rounds.
The summary must still identify partial/unprocessed coverage on failures.

This PR cannot validate its own eligibility by changing the reporter controls:
all original immutable source/control closure and README-only restrictions remain.
Local mocked tests prove the reviewed boundaries, not actual production execution.
The first hosted schedule/manual round after a separately authorized merge would
need observation; this task does not merge or activate the writer.

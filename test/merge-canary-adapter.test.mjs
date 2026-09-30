import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import {
  evaluateCanary,
  prepareEvaluation,
  trustedContext,
} from "../scripts/evaluate-merge-canary.mjs"

// All observations below are synthetic. This proves a contract, not a live PR's eligibility.
const { evaluateMergeEvidence } = await import(
  pathToFileURL(resolve(process.env.MERGE_EVALUATOR_MODULE)).href
)
const digest = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex")
const now = 1800000000000
test("trusted control reads bind regular file bytes and reject substituted local objects", () => {
  const root = mkdtempSync(resolve(tmpdir(), "merge-control-"))
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  const target = resolve(root, "control.json")
  const bytes = Buffer.from('{"trusted":true}\n')
  try {
    git("init", "--quiet")
    writeFileSync(target, bytes)
    git("add", "control.json")
    git(
      "-c",
      "user.name=Boundary Test",
      "-c",
      "user.email=boundary@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    )
    const revision = git("rev-parse", "HEAD")
    const read = () => trustedContext({ controlPaths: ["control.json"] }, bytes, root, revision)
    assert.equal(read().controls[0].sha256, digest(bytes))
    writeFileSync(target, Buffer.from('{"trusted":false}\n'))
    assert.throws(read, /modified-controller-control/)
    rmSync(target)
    const alternate = resolve(root, "same-bytes.json")
    writeFileSync(alternate, bytes)
    symlinkSync(alternate, target)
    assert.throws(read, /ELOOP/)
    rmSync(target)
    mkdirSync(target)
    assert.throws(read, /nonregular-control/)
    rmSync(target, { recursive: true })
    execFileSync("mkfifo", [target])
    assert.throws(read, /nonregular-control/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const policy = JSON.parse(
    readFileSync(new URL("../.github/merge-canary-policy.json", import.meta.url)),
  )
  const base = "a".repeat(40),
    head = "b".repeat(40),
    tested = "c".repeat(40)
  const context = {
    revision: base,
    policyFileDigest: digest("synthetic policy"),
    controls: policy.controlPaths.map((path) => {
      const bytes = Buffer.from(`synthetic ${path}`)
      return {
        path,
        sha256: digest(bytes),
        blob: digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1"),
      }
    }),
  }
  const observation = {
    schemaVersion: 1,
    collector: {
      revision: base,
      policyFileDigest: context.policyFileDigest,
      finishedAt: new Date(now).toISOString(),
    },
    collection: { status: "completed", errors: [], blockers: [] },
    observations: { drift: [] },
    repository: { ...policy.repository, visibility: "public" },
    pullRequest: {
      number: 67,
      state: "open",
      draft: false,
      baseSha: base,
      headSha: head,
      headRepoId: policy.repository.id,
      mergeable: true,
      mergeableState: "clean",
    },
    source: {
      controllerSha: base,
      mergeBaseSha: base,
      testedRevision: tested,
      proofStatus: "verified",
    },
    files: {
      expectedCount: 1,
      fetchedCount: 1,
      treeComplete: true,
      matchesTreeDiff: true,
      treeChangedPaths: ["README.md"],
      entries: [
        {
          path: "README.md",
          previousPath: null,
          status: "modified",
          oldMode: "100644",
          newMode: "100644",
        },
      ],
      pages: [{ page: 1, count: 1, bodyDigest: digest("synthetic API page") }],
    },
    controlClosure: {
      complete: true,
      allNonAllowlistedEntriesEqual: true,
      entries: context.controls.map(({ path, blob }) => ({
        path,
        baseBlob: blob,
        testedBlob: blob,
        mode: "100644",
      })),
    },
    protection: {
      ruleDetailStatus: "verified",
      ruleDetails: [{ id: 1, enforcement: "active", bypass_actors: [] }],
      rules: policy.expectedRuleTypes.map((type) => ({ type, ruleset_id: 1 })),
      checkRuns: [],
    },
    workflows: [],
    rawSarif: [],
    artifactInventories: [],
  }
  observation.protection.rules.find((r) => r.type === "required_status_checks").parameters = {
    strict_required_status_checks_policy: true,
    required_status_checks: policy.evaluation.requiredChecks.map((c) => ({
      context: c.context,
      integration_id: c.appId,
    })),
  }
  observation.protection.rules.find((r) => r.type === "code_quality").parameters = {
    severity: "errors",
  }
  observation.protection.rules.find((r) => r.type === "code_scanning").parameters = {
    code_scanning_tools: [
      { tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" },
    ],
  }
  for (const [index, expected] of policy.evaluation.runs.entries()) {
    const id = 100 + index
    const run = {
      workflowId: expected.workflowId,
      runId: id,
      path: expected.path,
      event: expected.event,
      attempt: 1,
      latestAttempt: 1,
      headSha: head,
      status: "completed",
      conclusion: "success",
      sourceProof: { status: "verified", kind: "trusted-inline-receipt-platform-correlation" },
      pages: [
        {
          route: `/repos/openboa-ai/openboa/actions/runs/${id}/attempts/1/jobs?per_page=100&page=1`,
          count: expected.jobs.length,
        },
      ],
    }
    run.jobs = expected.jobs.map((j, n) => ({
      id: 1000 + index * 100 + n,
      name: j.name,
      status: "completed",
      conclusion:
        expected.role === "ci" && ["check", "desktop"].includes(j.role) ? "skipped" : "success",
      steps:
        expected.role === "ci" && ["check", "desktop"].includes(j.role)
          ? []
          : j.steps.map((name) => ({ name, status: "completed", conclusion: "success" })),
    }))
    for (const j of run.jobs.filter((j) =>
      policy.evaluation.requiredChecks.some((c) => c.context === j.name),
    ))
      observation.protection.checkRuns.push({
        id: j.id,
        name: j.name,
        app: { id: 15368 },
        head_sha: head,
        status: "completed",
        conclusion: "success",
      })
    const inventory = { runId: id, artifacts: [] }
    for (const [n, j] of expected.jobs
      .filter((j) => expected.role !== "ci" || j.role === "scope")
      .entries()) {
      const name =
        expected.role === "codeql" ? `merge-evidence-${id}-1-${j.role}` : `merge-source-${id}-1`
      const artifactId = 2000 + index * 100 + n
      inventory.artifacts.push({ id: artifactId, name })
      const receipt = {
        schemaVersion: 1,
        repositoryId: policy.repository.id,
        repository: policy.repository.fullName,
        runId: id,
        runAttempt: 1,
        workflowRef: `${policy.repository.fullName}/${expected.path}@refs/pull/67/merge`,
        workflowPath: expected.path,
        workflowSha: tested,
        workflowSha256: context.controls.find((c) => c.path === expected.path).sha256,
        event: "pull_request",
        eventSha: tested,
        headSha: head,
        baseSha: base,
        checkoutSha: tested,
        parents: [base, head],
        jobName: j.name,
        ...(expected.role === "codeql"
          ? { language: j.role, category: policy.evaluation.receiptCategories[j.role] }
          : {}),
      }
      const envelope = {
        status: "verified",
        artifactId,
        runId: id,
        attempt: 1,
        jobId: run.jobs.find((job) => job.name === j.name).id,
        producerProof: { receipt },
      }
      if (expected.role === "codeql") {
        const rawSarif = JSON.stringify({
          version: "2.1.0",
          runs: [
            {
              tool: {
                driver: { name: "CodeQL", semanticVersion: policy.evaluation.codeqlVersion },
              },
              automationDetails: { id: policy.evaluation.sarifCategories[j.role] },
              results: [],
              invocations: [{ executionSuccessful: true }],
            },
          ],
        })
        observation.rawSarif.push({
          ...envelope,
          language: j.role,
          rawSarif,
          sarifDigest: digest(rawSarif),
        })
      } else run.sourceReceipt = envelope
    }
    observation.artifactInventories.push(inventory)
    observation.workflows.push(run)
  }
  const native = policy.evaluation.platformGate
  observation.platformGate = {
    runId: 500,
    workflowId: native.workflowId,
    path: native.path,
    event: native.event,
    attempt: 1,
    latestAttempt: 1,
    headSha: head,
    status: "completed",
    conclusion: "success",
    pages: [
      { route: "/actions/runs/500/attempts/1/jobs?per_page=100&page=1", count: native.jobs.length },
    ],
    jobs: native.jobs.map((name, n) => ({
      id: 3000 + n,
      name,
      status: "completed",
      conclusion: "success",
      steps: ["Initialize CodeQL", "Perform CodeQL Analysis"].map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    })),
  }
  for (const j of observation.platformGate.jobs)
    observation.protection.checkRuns.push({
      id: j.id,
      name: j.name,
      head_sha: head,
      app: { id: 15368 },
    })
  return { policy, observation, context }
}
function evaluate(f) {
  return evaluateCanary(f.policy, f.observation, f.context, evaluateMergeEvidence, now + 1)
}

test("real evaluator accepts the synthetic three-run collector contract without granting merge", () => {
  const f = fixture(),
    before = JSON.stringify(f)
  const result = evaluate(f)
  assert.equal(result.result.eligible, true, JSON.stringify(result))
  assert.equal(result.mergeAuthorized, false)
  assert.equal(result.mode, "report-only")
  assert.equal(JSON.stringify(f), before)
  assert.equal(new Set(result.result.runs.map((r) => r.id)).size, 3)
})
test("each missing proof, forged identity and changed control blocks through the real evaluator", () => {
  const mutations = [
    (f) => {
      delete f.observation.collection.errors
    },
    (f) => {
      f.observation.collection.status = "failure"
    },
    (f) => {
      f.observation.collector.policyFileDigest = "0".repeat(64)
    },
    (f) => {
      f.observation.collector.revision = "e".repeat(40)
    },
    (f) => {
      f.observation.controlClosure.allNonAllowlistedEntriesEqual = false
    },
    (f) => {
      f.observation.controlClosure.entries[0].testedBlob = "e".repeat(40)
    },
    (f) => {
      f.observation.protection.ruleDetailStatus = "unavailable"
    },
    (f) => {
      f.observation.protection.ruleDetails[0].bypass_actors = [{ actor_id: 7 }]
    },
    (f) => {
      f.observation.protection.checkRuns[0].app.id = 7
    },
    (f) => {
      f.observation.workflows[0].pages = []
    },
    (f) => {
      f.observation.workflows[0].sourceProof.status = "unavailable"
    },
    (f) => {
      f.observation.workflows[1].sourceProof.kind = "platform-local-reusable-reference"
    },
    (f) => {
      f.observation.rawSarif.pop()
    },
    (f) => {
      f.observation.rawSarif[0].rawSarif += " "
    },
    (f) => {
      f.observation.rawSarif[0].producerProof.receipt.runAttempt = 2
    },
    (f) => {
      f.observation.platformGate.latestAttempt = 2
    },
    (f) => {
      f.observation.pullRequest.mergeableState = "blocked"
    },
    (f) => {
      f.observation.protection.checkRuns.at(-1).app.id = 7
    },
    (f) => {
      f.observation.files.entries[0].path = ".github/workflows/ci.yml"
    },
  ]
  for (const mutate of mutations) {
    const f = fixture()
    mutate(f)
    assert.equal(evaluate(f).result.eligible, false, mutate.toString())
  }
})
test("infrastructure changes remain ineligible even with passing run conclusions", () => {
  const f = fixture()
  f.observation.files.treeChangedPaths = [".github/workflows/ci.yml"]
  f.observation.files.entries[0].path = ".github/workflows/ci.yml"
  assert.equal(evaluate(f).result.eligible, false)
})
test("mapping preserves real failures and does not manufacture a native rule verdict", () => {
  const f = fixture()
  f.observation.collection.errors.push({ code: "github_http_error", httpStatus: 403 })
  const { snapshot } = prepareEvaluation(f.policy, f.observation, f.context, now + 1)
  assert.deepEqual(snapshot.collection.errors, f.observation.collection.errors)
  assert.equal("ruleResult" in snapshot.platformGate, false)
  assert.equal(evaluate(f).result.eligible, false)
})

test("collector infrastructure failure takes precedence over additional missing-proof blockers", () => {
  const f = fixture()
  f.observation.collection.status = "failure"
  f.observation.collection.errors = [{ code: "github_http_error", httpStatus: 500 }]
  delete f.observation.source
  delete f.observation.controlClosure
  const report = evaluate(f)
  assert.equal(report.collectionStatus, "failure")
  assert.ok(report.blockers.length > 0)
  assert.equal(report.result.eligible, false)
})

// This assertion is deliberately a narrow approved execution contract, not a YAML parser.
// Unknown jobs, commands, environment values or actions require a reviewed test update.
function assertReporterBoundary(workflow, policy, evaluatorBytes) {
  // Pin the reviewed source, so alternative YAML spellings cannot escape these
  // readable assertions. This is a regression tripwire, not a malicious-YAML parser.
  assert.equal(digest(workflow), "bc12d3609a71931ab0a1b0c38c88508b46da78e9562bf9019909a38724fea297")
  // Flow-style steps/jobs and YAML aliases are outside this reviewed block-style contract.
  assert.doesNotMatch(
    workflow,
    /^\s*(?:-\s*\{|(?:jobs|steps|report):\s*[\[{]|<<:|[^#\n]*:\s*[&*])/m,
  )
  assert.match(workflow, /^on: # zizmor: ignore\[dangerous-triggers\] /m)
  assert.equal((workflow.match(/zizmor: ignore/g) ?? []).length, 1)
  const permissions = workflow.match(/^permissions:\n((?:  [^\n]+\n)+)/m)?.[1]
  assert.equal(
    permissions,
    "  contents: read\n  actions: read\n  checks: read\n  pull-requests: read\n",
  )
  assert.equal((workflow.match(/^\s*permissions:/gm) ?? []).length, 1)
  assert.deepEqual(
    [...workflow.matchAll(/^  ([a-z_-]+):$/gm)].map((m) => m[1]),
    ["workflow_run", "report"],
  )
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/)
  assert.ok(workflow.includes(`ref: ${policy.evaluator.revision}`))
  assert.match(policy.evaluator.revision, /^[a-f0-9]{40}$/)
  assert.equal(digest(evaluatorBytes), policy.evaluator.sha256)
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.match(workflow, /package-manager-cache: false/)
  assert.doesNotMatch(
    workflow,
    /secrets:|: write\b|write-all|actions\/cache@|\s+cache:|cache-dependency-path:|workflow_dispatch|pull_request_target/,
  )
  assert.deepEqual(
    [...workflow.matchAll(/          ref: (.+)/g)].map((m) => m[1]),
    ["${{ github.workflow_sha }}", policy.evaluator.revision],
  )
  const allowedActions = [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]
  assert.deepEqual(
    [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1]),
    allowedActions,
  )
  const commands = [...workflow.matchAll(/^        run: \|\n((?:          [^\n]*\n)+)/gm)].map(
    (m) => m[1].trim().replace(/\s+/g, " "),
  )
  assert.deepEqual(commands, [
    "node --test test/merge-canary-adapter.test.mjs python3 -m unittest discover -s test -p 'test_collect_merge_evidence.py'",
    'python3 scripts/collect-merge-evidence.py \\ --policy .github/merge-canary-policy.json \\ --event "$GITHUB_EVENT_PATH" \\ --output "$RUNNER_TEMP/merge-canary/observations.json"',
    'node scripts/evaluate-merge-canary.mjs \\ --policy .github/merge-canary-policy.json \\ --observations "$RUNNER_TEMP/merge-canary/observations.json" \\ --evaluator .merge-evaluator/lib/evaluate-merge-evidence.mjs \\ --output "$RUNNER_TEMP/merge-canary/report.json"',
  ])
  assert.equal((workflow.match(/^\s*(?:- )?run:/gm) ?? []).length, 3)
  const environments = [...workflow.matchAll(/^        env:\n((?:          [^\n]+\n)+)/gm)].map(
    (m) => m[1].trim().replace(/\s+/g, " "),
  )
  assert.deepEqual(environments, [
    'MERGE_EVALUATOR_MODULE: ${{ github.workspace }}/.merge-evaluator/lib/evaluate-merge-evidence.mjs PYTHONDONTWRITEBYTECODE: "1"',
    "GITHUB_TOKEN: ${{ github.token }} GITHUB_WORKFLOW_SHA: ${{ github.workflow_sha }}",
    "GITHUB_WORKFLOW_SHA: ${{ github.workflow_sha }}",
  ])
  assert.equal((workflow.match(/^\s*env:/gm) ?? []).length, 3)
  assert.equal(policy.mode, "report-only")
}
function reporterFixture() {
  return {
    policy: JSON.parse(
      readFileSync(new URL("../.github/merge-canary-policy.json", import.meta.url)),
    ),
    workflow: readFileSync(
      new URL("../.github/workflows/merge-canary.yml", import.meta.url),
      "utf8",
    ),
    bytes: readFileSync(process.env.MERGE_EVALUATOR_MODULE),
  }
}
test("approved reporter exception retains exact read-only execution boundary", () => {
  const { workflow, policy, bytes } = reporterFixture()
  assertReporterBoundary(workflow, policy, bytes)
})
test("reporter boundary rejects candidate execution, privilege, cache and untrusted-input regressions", () => {
  const { workflow, policy, bytes } = reporterFixture()
  const mutations = [
    (w) => w.replace("github.workflow_sha", "github.event.workflow_run.head_sha"),
    (w) => w.replace(`ref: ${policy.evaluator.revision}`, "ref: main"),
    (w) => w.replace("contents: read", "contents: write"),
    (w) => w.replace("    runs-on:", "    permissions: write-all\n    runs-on:"),
    (w) => w.replace("persist-credentials: false", "persist-credentials: true"),
    (w) => w.replace('node-version: "22"', 'node-version: "22"\n          cache: npm'),
    (w) => w.replace("package-manager-cache: false", "package-manager-cache: true"),
    (w) => w.replace("actions/setup-node@", "actions/cache@"),
    (w) =>
      w.replace(
        "          PYTHONDONTWRITEBYTECODE:",
        "          NODE_OPTIONS: ${{ github.event.workflow_run.head_branch }}\n          PYTHONDONTWRITEBYTECODE:",
      ),
    (w) => w.replace("node --test", "npm install && node --test"),
    (w) =>
      w.replace("node --test", "echo ${{ github.event.workflow_run.head_branch }}; node --test"),
    (w) => w + "\n      - run: gh pr merge 1\n",
    (w) => w + "\n      - uses: ./candidate-action\n",
    (w) => w + "\n      - {uses: ./candidate-action}\n",
    (w) => w + '\n  extra: {runs-on: ubuntu-latest, steps: [{run: "echo added-execution"}]}\n',
    (w) =>
      w.replace(
        "jobs:\n",
        "jobs: {report: {runs-on: ubuntu-latest, steps: [{run: 'npm install'}]}}\n",
      ),
    (w) => w + "\n  merge:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n",
    (w) => w.replace("jobs:\n", "env:\n  NODE_OPTIONS: --require ./candidate.js\njobs:\n"),
    (w) =>
      w.replace("report:\n", "report:\n    env:\n      NODE_OPTIONS: --require ./candidate.js\n"),
  ]
  for (const mutate of mutations) {
    assert.notEqual(mutate(workflow), workflow)
    assert.throws(
      () => assertReporterBoundary(mutate(workflow), policy, bytes),
      undefined,
      mutate.toString(),
    )
  }
  assert.throws(() =>
    assertReporterBoundary(workflow, policy, Buffer.concat([bytes, Buffer.from(" ")])),
  )
  const modifiedPolicy = structuredClone(policy)
  modifiedPolicy.evaluator.sha256 = "0".repeat(64)
  assert.throws(() => assertReporterBoundary(workflow, modifiedPolicy, bytes))
  modifiedPolicy.evaluator.sha256 = policy.evaluator.sha256
  modifiedPolicy.mode = "merge"
  assert.throws(() => assertReporterBoundary(workflow, modifiedPolicy, bytes))
})

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { evaluateCanary, prepareEvaluation } from "../scripts/evaluate-merge-canary.mjs"

// All observations below are synthetic. This proves a contract, not a live PR's eligibility.
const { evaluateMergeEvidence } = await import(
  pathToFileURL(resolve(process.env.MERGE_EVALUATOR_MODULE)).href
)
const digest = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex")
const now = 1800000000000
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

test("reporter retains read-only default-source execution and exact evaluator pin", () => {
  const policy = JSON.parse(
    readFileSync(new URL("../.github/merge-canary-policy.json", import.meta.url)),
  )
  const workflow = readFileSync(
    new URL("../.github/workflows/merge-canary.yml", import.meta.url),
    "utf8",
  )
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/)
  assert.ok(workflow.includes(`ref: ${policy.evaluator.revision}`))
  assert.equal(digest(readFileSync(process.env.MERGE_EVALUATOR_MODULE)), policy.evaluator.sha256)
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.equal((workflow.match(/: write\b/g) ?? []).length, 0)
  for (const permission of ["contents", "actions", "checks", "pull-requests"])
    assert.match(workflow, new RegExp(`  ${permission}: read`))
  assert.doesNotMatch(
    workflow,
    /workflow_run\.head_sha[^\n]*\n\s+persist-credentials|secrets: inherit|actions\/cache@|pnpm install|npm install|gh pr merge|workflow_dispatch/,
  )
  assert.equal(policy.mode, "report-only")
})

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex")
const array = (value) => (Array.isArray(value) ? value : [])
const clean = (value) => JSON.parse(JSON.stringify(value))
const sameSet = (left, right) =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  left.every((v) => right.includes(v))

// Files come only from the controller checkout, never an API-selected candidate path.
export function trustedContext(policy, policyBytes, root, revision) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? "")) throw new Error("invalid-controller-revision")
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  if (actual !== revision) throw new Error("controller-checkout-mismatch")
  const controls = policy.controlPaths.map((path) => {
    if (!/^[a-zA-Z0-9._/-]+$/.test(path) || path.split("/").some((p) => p === ".." || !p)) {
      throw new Error("invalid-control-path")
    }
    const target = resolve(root, path)
    // Inspect and read the same opened object. NOFOLLOW rejects a final symlink;
    // NONBLOCK prevents an unexpected FIFO from blocking before fstat rejects it.
    const descriptor = openSync(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    let bytes
    try {
      if (!fstatSync(descriptor).isFile()) throw new Error("nonregular-control")
      bytes = readFileSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    const blob = hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1")
    const committed = execFileSync("git", ["rev-parse", `${revision}:${path}`], {
      cwd: root,
      encoding: "utf8",
    }).trim()
    if (blob !== committed) throw new Error("modified-controller-control")
    return { path, blob, sha256: hash(bytes) }
  })
  return { revision, policyFileDigest: hash(policyBytes), controls }
}

// Normalize authenticated collector observations. Missing evidence is retained as
// missing or blocked; no manifest field can replace a platform observation.
export function prepareEvaluation(policy, observation, context, now = Date.now()) {
  const blockers = [...array(observation.collection?.blockers)]
  const block = (condition, reason) => {
    if (!condition) blockers.push(reason)
  }
  block(policy.mode === "report-only", "report-only-mode-required")
  block(observation.schemaVersion === 1, "unknown-collector-schema")
  block(
    Array.isArray(observation.collection?.blockers) &&
      Array.isArray(observation.collection?.errors) &&
      Array.isArray(observation.observations?.drift),
    "collection-status-fields-missing",
  )
  block(
    observation.collector?.policyFileDigest === context.policyFileDigest,
    "policy-file-digest-mismatch",
  )
  block(observation.collector?.revision === context.revision, "collector-revision-mismatch")
  block(observation.source?.controllerSha === context.revision, "controller-no-longer-current")
  const source = observation.source ?? {}
  const pull = observation.pullRequest ?? {}
  const files = observation.files ?? {}
  const controls = observation.controlClosure ?? {}
  block(controls.allNonAllowlistedEntriesEqual === true, "executable-closure-not-unchanged")
  block(
    sameSet(
      array(controls.entries).map((entry) => entry.path),
      context.controls.map((entry) => entry.path),
    ),
    "control-set-mismatch",
  )
  const closureEntries = context.controls.map((trusted) => {
    const observed = array(controls.entries).find((entry) => entry.path === trusted.path)
    const matches =
      observed?.baseBlob === trusted.blob &&
      observed?.testedBlob === trusted.blob &&
      observed?.mode === "100644"
    block(matches, "control-blob-mismatch")
    return {
      path: trusted.path,
      baseSha256: matches ? trusted.sha256 : null,
      headSha256: matches ? trusted.sha256 : null,
      testedSha256: matches && source.proofStatus === "verified" ? trusted.sha256 : null,
      baseMode: matches ? "100644" : null,
      headMode: observed?.mode,
      testedMode: matches && source.proofStatus === "verified" ? "100644" : null,
    }
  })
  const protection = observation.protection ?? {}
  const rules = array(protection.rules)
  const details = array(protection.ruleDetails)
  const rule = (type) => rules.filter((entry) => entry.type === type)
  block(
    sameSet(
      rules.map((entry) => entry.type),
      policy.expectedRuleTypes,
    ),
    "effective-rule-set-changed",
  )
  const ruleIds = [...new Set(rules.map((entry) => entry.ruleset_id))]
  block(
    sameSet(
      details.map((entry) => entry.id),
      ruleIds,
    ),
    "rule-details-incomplete",
  )
  const detailsVerified =
    protection.ruleDetailStatus === "verified" &&
    protection.ruleDetailRereadStatus === "unchanged" &&
    details.length > 0 &&
    details.every(
      (entry) => entry.enforcement === "active" && entry.current_user_can_bypass === "never",
    )
  const applicableRulesets = [
    ...new Map(
      rules.map((entry) => [
        entry.ruleset_id,
        {
          id: entry.ruleset_id,
          sourceType: entry.ruleset_source_type,
          source: entry.ruleset_source,
        },
      ]),
    ).values(),
  ]
  block(
    rules.every((entry) =>
      applicableRulesets.some(
        (rule) =>
          rule.id === entry.ruleset_id &&
          rule.sourceType === entry.ruleset_source_type &&
          rule.source === entry.ruleset_source,
      ),
    ),
    "ruleset-source-conflict",
  )
  const principalObservation = (detail, requests) => ({
    id: detail?.id,
    sourceType: detail?.source_type,
    source: detail?.source,
    enforcement: detail?.enforcement,
    currentUserCanBypass: detail?.current_user_can_bypass,
    request:
      array(requests).filter((entry) => entry.rulesetId === detail?.id).length === 1
        ? array(requests).find((entry) => entry.rulesetId === detail?.id).request
        : null,
  })
  const statusRule = rule("required_status_checks")[0]?.parameters
  const scanTools = rule("code_scanning")[0]?.parameters?.code_scanning_tools
  const checks = array(protection.checkRuns)
  const mapJobs = (raw) =>
    array(raw.jobs).map((job) => ({
      ...job,
      runId: raw.runId,
      attempt: raw.attempt,
      headSha: raw.headSha,
      stepsComplete: Array.isArray(job.steps),
    }))
  const jobsComplete = (raw) => {
    const pages = array(raw.pages).filter((page) =>
      page.route?.includes(`/attempts/${raw.attempt}/jobs?`),
    )
    return (
      pages.length > 0 &&
      pages.reduce((sum, page) => sum + page.count, 0) === array(raw.jobs).length
    )
  }
  const artifactName = (envelope) =>
    array(observation.artifactInventories)
      .flatMap((entry) => array(entry.artifacts))
      .find((entry) => entry.id === envelope.artifactId)?.name
  const sourceEnvelope = (envelope) => ({
    status: envelope.status,
    artifactId: envelope.artifactId,
    artifactName: artifactName(envelope),
    jobId: envelope.jobId,
    receipt: envelope.producerProof?.receipt,
  })
  const runs = array(observation.workflows).map((raw) => {
    const expected = policy.evaluation.runs.find((entry) => entry.workflowId === raw.workflowId)
    const receipts =
      expected?.role === "codeql"
        ? array(observation.rawSarif).filter((entry) => entry.runId === raw.runId)
        : raw.sourceReceipt
          ? [raw.sourceReceipt]
          : []
    return {
      role: expected?.role,
      id: raw.runId,
      repositoryId: observation.repository?.id,
      workflowId: raw.workflowId,
      path: raw.path,
      event: raw.event,
      attempt: raw.attempt,
      latestAttempt: raw.latestAttempt,
      baseSha: pull.baseSha,
      headSha: raw.headSha,
      controlSha: observation.collector?.revision,
      status: raw.status,
      conclusion: raw.conclusion,
      jobsComplete: jobsComplete(raw),
      totalJobs: array(raw.jobs).length,
      jobs: mapJobs(raw),
      sourceProof: {
        status: raw.sourceProof?.status,
        kind: raw.sourceProof?.kind,
        receipts: receipts.map(sourceEnvelope),
      },
    }
  })
  for (const required of policy.evaluation.requiredChecks) {
    const jobs = runs.flatMap((run) => run.jobs).filter((job) => job.name === required.context)
    const matching = checks.filter(
      (check) =>
        jobs.some((job) => job.id === check.id) &&
        check.app?.id === required.appId &&
        check.head_sha === pull.headSha &&
        check.status === "completed" &&
        check.conclusion === "success",
    )
    block(
      jobs.length === 1 && matching.length === 1,
      "required-check-platform-identity-unavailable",
    )
  }
  const native = observation.platformGate ?? {}
  const nativeJobs = mapJobs(native)
  const nativeApps = nativeJobs
    .map((job) =>
      checks.filter(
        (check) =>
          check.id === job.id && check.head_sha === native.headSha && check.name === job.name,
      ),
    )
    .map((matches) => (matches.length === 1 ? matches[0].app?.id : null))
  const sarif = array(observation.rawSarif).map((entry) => ({
    language: entry.language,
    jobName: entry.producerProof?.receipt?.jobName,
    runId: entry.runId,
    attempt: entry.attempt,
    headSha: entry.producerProof?.receipt?.headSha,
    errors: entry.status === "verified" ? [] : [entry.reason ?? "unverified-sarif"],
    rawSarif: entry.rawSarif,
    sha256: entry.sarifDigest,
    provenance: {
      status: entry.status,
      artifactId: entry.artifactId,
      artifactName: artifactName(entry),
      jobId: entry.jobId,
      runId: entry.runId,
      attempt: entry.attempt,
      workflowSha: entry.producerProof?.receipt?.workflowSha,
    },
  }))
  const expectedPolicy = {
    ...policy.evaluation,
    repository: { id: policy.repository.id, fullName: policy.repository.fullName },
    controlSha: context.revision,
    allowedDocumentationPaths: policy.allowedDocumentationPaths,
    controlClosure: context.controls.map(({ path, sha256 }) => ({ path, sha256 })),
  }
  const snapshot = {
    version: 1,
    collection: {
      principal: observation.collector?.principal,
      status:
        observation.collection?.status === "failure" ||
        array(observation.collection?.errors).length > 0
          ? "failure"
          : blockers.length
            ? "blocked"
            : observation.collection?.status,
      blockers: [...new Set(blockers)],
      errors: array(observation.collection?.errors),
      drift: array(observation.observations?.drift).length !== 0,
    },
    collectedAt: Date.parse(observation.collector?.finishedAt),
    evaluationTime: now,
    selection: {
      status: source.proofStatus,
      pullRequestNumber: pull.number,
      baseSha: pull.baseSha,
      headSha: pull.headSha,
      testedSha: source.testedRevision,
      platformGate: {
        id: native.runId,
        attempt: native.attempt,
        latestAttempt: native.latestAttempt,
      },
      runs: runs.map(({ role, id, attempt, latestAttempt }) => ({
        role,
        id,
        attempt,
        latestAttempt,
      })),
    },
    repository: { ...observation.repository, defaultBranchSha: source.controllerSha },
    pullRequest: {
      ...pull,
      headRepositoryId: pull.headRepoId,
      baseAncestorOfHead: source.mergeBaseSha === pull.baseSha,
      changedFiles: files.expectedCount,
    },
    controlSha: observation.collector?.revision,
    scope:
      files.matchesTreeDiff === true &&
      array(files.treeChangedPaths).length > 0 &&
      array(files.treeChangedPaths).every((path) => policy.allowedDocumentationPaths.includes(path))
        ? "allowlisted-documentation"
        : "unclassified",
    files: {
      complete: files.expectedCount === files.fetchedCount && files.matchesTreeDiff === true,
      treeComplete: files.treeComplete,
      treesTruncated: files.treeComplete === true ? false : null,
      totalCount: files.fetchedCount,
      pages: array(files.pages).map((page) => ({
        number: page.page,
        count: page.count,
        bodySha256: page.bodyDigest,
      })),
      entries: array(files.entries).map(({ path, previousPath, status, oldMode, newMode }) => ({
        path,
        ...(previousPath == null ? {} : { previousPath }),
        status,
        oldMode,
        newMode,
      })),
    },
    controlClosure: {
      complete: controls.complete === true && controls.allNonAllowlistedEntriesEqual === true,
      entries: closureEntries,
    },
    rules: {
      complete: detailsVerified,
      enforcement: detailsVerified ? "active" : "unavailable",
      requirePullRequest: rule("pull_request").length === 1,
      strictRequiredChecks: statusRule?.strict_required_status_checks_policy,
      applicableRulesets,
      currentPrincipalBypass: {
        status: detailsVerified ? "verified" : "unavailable",
        principal: observation.collector?.principal,
        rulesets: details.map((detail) => ({
          initial: principalObservation(detail, protection.ruleDetailRequests),
          final: principalObservation(
            array(protection.ruleDetailsAfter).filter((entry) => entry.id === detail.id).length ===
              1
              ? array(protection.ruleDetailsAfter).find((entry) => entry.id === detail.id)
              : null,
            protection.ruleDetailRequestsAfter,
          ),
        })),
      },
      requiredChecks: array(statusRule?.required_status_checks).map((check) => ({
        context: check.context,
        appId: check.integration_id,
      })),
      codeQuality: rule("code_quality")[0]?.parameters?.severity,
      codeScanning:
        array(scanTools).length === 1
          ? {
              tool: scanTools[0].tool,
              securityThreshold: scanTools[0].security_alerts_threshold,
              alertsThreshold: scanTools[0].alerts_threshold,
            }
          : null,
    },
    runs,
    sarif,
    platformGate: {
      id: native.runId,
      workflowId: native.workflowId,
      path: native.path,
      event: native.event,
      repositoryId: observation.repository?.id,
      headSha: native.headSha,
      attempt: native.attempt,
      latestAttempt: native.latestAttempt,
      status: native.status,
      conclusion: native.conclusion,
      complete: jobsComplete(native),
      appId:
        nativeApps.length > 0 &&
        nativeApps.every((id) => id === policy.evaluation.platformGate.appId)
          ? nativeApps[0]
          : null,
      totalJobs: nativeJobs.length,
      jobs: nativeJobs,
    },
  }
  return clean({ policy: expectedPolicy, snapshot })
}

export function evaluateCanary(policy, observation, context, evaluate, now = Date.now()) {
  const inputs = prepareEvaluation(policy, observation, context, now)
  const result = evaluate(inputs.policy, inputs.snapshot)
  if (typeof result?.eligible !== "boolean") throw new Error("invalid-evaluator-result")
  return {
    schemaVersion: 1,
    mode: "report-only",
    mergeAuthorized: false,
    collectionStatus: inputs.snapshot.collection.status,
    blockers: inputs.snapshot.collection.blockers,
    errors: inputs.snapshot.collection.errors,
    result,
  }
}

async function main() {
  const args = Object.fromEntries(
    Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
      process.argv[2 + i * 2],
      process.argv[3 + i * 2],
    ]),
  )
  if (!sameSet(Object.keys(args), ["--policy", "--observations", "--evaluator", "--output"]))
    throw new Error("invalid-arguments")
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const bytes = readFileSync(args["--policy"])
  if (bytes.length > 1024 * 1024) throw new Error("policy-over-budget")
  const policy = JSON.parse(bytes)
  const observations = readFileSync(args["--observations"])
  if (observations.length > 30 * 1024 * 1024) throw new Error("observations-over-budget")
  const evaluatorBytes = readFileSync(args["--evaluator"])
  if (hash(evaluatorBytes) !== policy.evaluator?.sha256)
    throw new Error("evaluator-digest-mismatch")
  const { evaluateMergeEvidence } = await import(pathToFileURL(resolve(args["--evaluator"])).href)
  const context = trustedContext(policy, bytes, root, process.env.GITHUB_WORKFLOW_SHA)
  const report = evaluateCanary(policy, JSON.parse(observations), context, evaluateMergeEvidence)
  mkdirSync(dirname(resolve(args["--output"])), { recursive: true })
  writeFileSync(args["--output"], `${JSON.stringify(report, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Read-only merge canary: ${report.result.eligible ? "eligible under the reviewed policy" : "ineligible"}. No merge authorized.\n\nCollection: ${report.collectionStatus}. See the bounded report artifact for evidence and blockers.\n`,
    )
  }
  console.log(
    JSON.stringify({ mode: report.mode, eligible: report.result.eligible, mergeAuthorized: false }),
  )
  if (report.collectionStatus === "failure") process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("Merge canary evaluation failed; no eligibility or merge authorization issued")
    process.exitCode = 1
  })
}

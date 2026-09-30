import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function sourceStep(name: string) {
  const workflow = readFileSync(
    new URL(`../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  )
  const body = workflow
    .split("      - name: Record source receipt\n")[1]
    .split("\n      - name:")[0]
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
  return { workflow, body }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "openboa-source-receipt-"))
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" })
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  git("init", "-q")
  mkdirSync(join(directory, ".github/workflows"), { recursive: true })
  mkdirSync(join(directory, "src"))
  for (const name of ["ci", "codeql", "pr-convention"]) {
    writeFileSync(join(directory, `.github/workflows/${name}.yml`), `name: ${name}\n`)
  }
  writeFileSync(
    join(directory, "src/source.ts"),
    "throw new Error('candidate must never execute')\n",
  )
  writeFileSync(
    join(directory, "helper.py"),
    "raise RuntimeError('candidate must never execute')\n",
  )
  writeFileSync(join(directory, "README.md"), "An inert documentation change.\n")
  git("add", ".")
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  )
  const parent = git("rev-parse", "HEAD")
  writeFileSync(join(directory, "README.md"), "Updated documentation.\n")
  git("add", "README.md")
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "docs",
  )
  return { directory, git, parent, head: git("rev-parse", "HEAD") }
}

describe("inline source provenance producer", () => {
  it.each(["ci", "codeql", "pr-convention"])(
    "%s records real immutable Git objects without executing candidate code",
    (name) => {
      const { directory, git, parent, head } = fixture()
      const output = join(directory, "receipt-output")
      const eventPath = join(directory, "event.json")
      const workflowPath = `.github/workflows/${name}.yml`
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { head: { sha: head }, base: { sha: parent } } }),
      )
      const env = {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_SHA: head,
        GITHUB_REPOSITORY: "openboa-ai/openboa",
        REPOSITORY_ID: "1214829403",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        WORKFLOW_REF: `openboa-ai/openboa/${workflowPath}@refs/pull/67/merge`,
        WORKFLOW_SHA: head,
        WORKFLOW_PATH: workflowPath,
        JOB_NAME: name === "codeql" ? "analyze (javascript-typescript)" : name,
        EXPECTED_REVISION: head,
        RECEIPT_DIRECTORY: output,
        LANGUAGE: name === "codeql" ? "javascript-typescript" : "",
        CATEGORY: name === "codeql" ? ".github/workflows/codeql.yml:analyze" : "",
      }
      try {
        const script = sourceStep(name).body
        const run = (overrides: Record<string, string> = {}) =>
          spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
            cwd: directory,
            env: { ...env, ...overrides },
            encoding: "utf8",
          })
        const result = run()
        expect(result.status, result.stderr).toBe(0)
        const receipt = JSON.parse(readFileSync(join(output, "receipt.json"), "utf8"))
        expect(receipt.checkoutSha).toBe(head)
        expect(receipt.parents).toEqual([parent])
        expect(receipt.sourceTree).toBe(git("rev-parse", "HEAD^{tree}"))
        expect(receipt.workflowSha256).toBe(
          createHash("sha256").update(`name: ${name}\n`).digest("hex"),
        )
        expect(receipt.repositoryId).toBe(1214829403)
        expect(receipt.runId).toBe(123)
        expect(receipt.sourceFiles.map((file: { path: string }) => file.path)).toEqual(
          name === "codeql" ? ["src/source.ts"] : [],
        )
        for (const override of [
          { EXPECTED_REVISION: parent },
          { EXPECTED_REVISION: "main" },
          { WORKFLOW_SHA: "0".repeat(40) },
        ]) {
          expect(run(override).status).not.toBe(0)
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )

  it("isolates scanner production from candidate execution and records before scanning", () => {
    const { workflow } = sourceStep("codeql")
    expect(workflow).toContain("build-mode: none")
    expect(workflow).toContain("queries: security-and-quality")
    expect(workflow).not.toMatch(/pnpm|npm install|run: node |run: python3 scripts/)
    expect(workflow.indexOf("name: Record source receipt")).toBeLessThan(
      workflow.indexOf("name: Initialize CodeQL"),
    )
    expect(workflow.indexOf("name: Perform CodeQL Analysis")).toBeLessThan(
      workflow.indexOf("name: Prepare merge evidence"),
    )
    expect(workflow.indexOf("name: Prepare merge evidence")).toBeLessThan(
      workflow.indexOf("name: Upload merge evidence"),
    )
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain("if-no-files-found: error")
    expect(workflow).not.toContain("continue-on-error")
    for (const name of ["ci", "pr-convention"]) {
      const source = sourceStep(name).workflow
      expect(source.indexOf("name: Upload source receipt")).toBeLessThan(
        source.indexOf(name === "ci" ? "name: Detect docs scope" : "name: Setup Node"),
      )
    }
  })
})

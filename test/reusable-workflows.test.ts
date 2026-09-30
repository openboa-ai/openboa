import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const readWorkflow = (name: string) =>
  readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8")

function stepShell(workflow: string, name: string) {
  const step = workflow.split(`      - name: ${name}\n`)[1].split("\n      - name:")[0]
  return step
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
}

describe("reusable validation source binding", () => {
  it.each(["ci", "codeql", "dependency-audit"])(
    "%s validates and uses the server event SHA, with no caller-selected source",
    (name) => {
      const workflow = readWorkflow(name)
      const guard = stepShell(workflow, "Validate revision")
      for (const revision of [
        "main",
        "refs/heads/main",
        "a".repeat(39),
        "g".repeat(40),
        "a; exit 0",
        "",
      ]) {
        expect(
          spawnSync("bash", ["-e", "-o", "pipefail", "-c", guard], {
            env: { ...process.env, REVISION: revision },
          }).status,
        ).toBe(1)
      }
      expect(
        spawnSync("bash", ["-e", "-o", "pipefail", "-c", guard], {
          env: { ...process.env, REVISION: "abcdef0123".repeat(4) },
        }).status,
      ).toBe(0)
      expect(workflow).not.toContain("inputs.revision")
      expect(workflow).not.toContain("      revision:")
      const checkouts = workflow.split(/uses: actions\/checkout@[^\n]+\n/).slice(1)
      expect(checkouts.length).toBeGreaterThan(0)
      for (const checkout of checkouts) {
        expect(checkout.split(/\n\s*- name:/)[0]).toMatch(/ref: \$\{\{ github\.sha \}\}/)
      }
      expect(workflow.indexOf("name: Validate revision")).toBeLessThan(
        workflow.indexOf("name: Checkout"),
      )
    },
  )

  it("uses the same server event in nested audit and preserves ordinary CI concurrency", () => {
    const workflow = readWorkflow("ci")
    expect(workflow).toContain("uses: ./.github/workflows/dependency-audit.yml")
    expect(workflow).not.toContain("inputs.revision")
    expect(workflow).toContain("if: inputs.full_scope != true")
    expect(workflow).toMatch(/group: ci-\$\{\{ github\.workflow \}\}-/)
    expect(workflow).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
  })

  it("keeps ordinary CodeQL identity and isolates callable analysis explicitly", () => {
    const workflow = readWorkflow("codeql")
    expect(workflow).not.toContain("inputs.revision")
    expect(workflow).not.toContain("inputs.analysis_ref")
    expect(workflow).toContain("inputs.isolated_analysis == true && 'never' || 'always'")
    expect(workflow).toContain("inputs.isolated_analysis == true && 'reusable-validation:' || ''")
    for (const suffix of ["analyze", "analyze-python", "analyze-actions"]) {
      expect(workflow).toContain(`category: .github/workflows/codeql.yml:${suffix}`)
    }
    expect(workflow).toContain("if: inputs.strict_postmerge == true")
  })

  it("uses distinct validation workflow identity and actual full calls without uploading CodeQL", () => {
    const harness = readWorkflow("reusable-validation")
    expect(harness).toContain("name: reusable-validation")
    expect(harness).toContain("paths:")
    expect(harness).toContain("uses: ./.github/workflows/ci.yml")
    expect(harness).toContain("full_scope: true")
    expect(harness).toContain("uses: ./.github/workflows/codeql.yml")
    expect(harness).toContain("isolated_analysis: true")
    expect(harness).not.toContain("revision:")
    expect(harness).not.toContain("actions: write")
    expect(harness).not.toContain("contents: write")
  })
})

describe("genuine reusable CodeQL output validation", () => {
  it("rejects absent, malformed, and wrong-tool output instead of a passing placeholder", () => {
    const directory = mkdtempSync(join(tmpdir(), "openboa-codeql-call-"))
    try {
      const run = () =>
        spawnSync(
          "bash",
          [
            "-e",
            "-o",
            "pipefail",
            "-c",
            stepShell(readWorkflow("codeql"), "Validate reusable analysis output"),
          ],
          {
            encoding: "utf8",
            env: { ...process.env, SARIF_DIRECTORY: directory },
          },
        )
      expect(run().status).not.toBe(0)
      const path = join(directory, "javascript.sarif")
      for (const document of [
        "not json",
        { version: "2.1.0", runs: [] },
        { version: "2.1.0", runs: [{ tool: { driver: { name: "fake" } }, results: [] }] },
      ]) {
        writeFileSync(path, typeof document === "string" ? document : JSON.stringify(document))
        expect(run().status).not.toBe(0)
      }
      writeFileSync(
        path,
        JSON.stringify({
          version: "2.1.0",
          runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }],
        }),
      )
      expect(run().status).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

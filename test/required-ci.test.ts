import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
const gateJob = workflow.split("\n  required-ci:\n")[1]
const scopeStep = workflow.split("      - name: Compute scope flags\n")[1].split("\n  check:")[0]

function shellBody(source: string) {
  return source
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n")
}

const gate = shellBody(gateJob)

function runScope(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openboa-ci-scope-"))
  const output = join(directory, "output")
  try {
    writeFileSync(output, "", { mode: 0o600 })
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", shellBody(scopeStep)], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        FULL_SCOPE: "false",
        DOCS_CHANGED: "true",
        DESKTOP_CHANGED: "false",
        NON_DOCS_CHANGED: "false",
        ...overrides,
      },
    })
    return { ...result, outputs: readFileSync(output, "utf8") }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const fullScope: Record<string, string> = {
  "scope.result": "success",
  "scope.outputs.docs_only": "false",
  "scope.outputs.docs_changed": "true",
  "scope.outputs.desktop_changed": "true",
  "check.result": "success",
  "docs.result": "success",
  "desktop-artifact.result": "success",
  "secrets.result": "success",
  "gitleaks.result": "success",
  "policy.result": "success",
  "dependency-audit.result": "success",
}

function runGate(overrides: Record<string, string> = {}) {
  const needs = { ...fullScope, ...overrides }
  const script = gate.replace(/\$\{\{ needs\.([\w.-]+) \}\}/g, (_, name) => needs[name] ?? "")
  return spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], { encoding: "utf8" })
}

describe("scope output validation", () => {
  it("runs every protected lane in explicit full-scope mode without diff outputs", () => {
    const result = runScope({
      FULL_SCOPE: "true",
      DOCS_CHANGED: "",
      DESKTOP_CHANGED: "",
      NON_DOCS_CHANGED: "",
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toBe("docs_changed=true\ndesktop_changed=true\ndocs_only=false\n")
    expect(runGate().status).toBe(0)
    for (const lane of ["check", "docs", "desktop-artifact"]) {
      expect(runGate({ [`${lane}.result`]: "skipped" }).status).toBe(1)
    }
  })

  it("rejects malformed full-scope mode before emitting any applicability outputs", () => {
    for (const value of ["", "True", "unknown", "true; exit 0"]) {
      const result = runScope({ FULL_SCOPE: value })
      expect(result.status).toBe(1)
      expect(result.outputs).toBe("")
    }
  })

  it("passes path-filter outputs through environment variables", () => {
    expect(scopeStep).toMatch(/DOCS_CHANGED: \$\{\{ steps\.filter\.outputs\.docs \}\}/)
    expect(scopeStep).toMatch(/DESKTOP_CHANGED: \$\{\{ steps\.filter\.outputs\.desktop \}\}/)
    expect(scopeStep).toMatch(/NON_DOCS_CHANGED: \$\{\{ steps\.filter\.outputs\.non_docs \}\}/)
  })

  it.each(["DOCS_CHANGED", "DESKTOP_CHANGED", "NON_DOCS_CHANGED"])(
    "rejects missing or malformed %s before emitting any normalized outputs",
    (flag) => {
      for (const value of ["", "unknown", "True", "false; exit 0"]) {
        const result = runScope({ [flag]: value })
        expect(result.status).toBe(1)
        expect(result.outputs).toBe("")
      }
    },
  )

  it.each([
    ["true", "false", "false", "true"],
    ["true", "true", "false", "true"],
    ["true", "true", "true", "false"],
    ["false", "true", "true", "false"],
    ["false", "false", "true", "false"],
  ])(
    "preserves docs=%s desktop=%s non_docs=%s applicability",
    (docs, desktop, nonDocs, docsOnly) => {
      const result = runScope({
        DOCS_CHANGED: docs,
        DESKTOP_CHANGED: desktop,
        NON_DOCS_CHANGED: nonDocs,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toBe(
        `docs_changed=${docs}\ndesktop_changed=${desktop}\ndocs_only=${docsOnly}\n`,
      )
      expect(
        runGate({
          "scope.outputs.docs_only": docsOnly,
          "scope.outputs.docs_changed": docs,
          "scope.outputs.desktop_changed": desktop,
          "check.result": docsOnly === "true" ? "skipped" : "success",
          "docs.result": docs === "true" ? "success" : "skipped",
          "desktop-artifact.result":
            docsOnly === "false" && desktop === "true" ? "success" : "skipped",
        }).status,
      ).toBe(0)
    },
  )
})

describe("required-ci workflow gate", () => {
  it("waits for scope even when downstream jobs are skipped", () => {
    expect(gateJob).toMatch(/needs: \[[^\]\n]*\bscope\b/)
    expect(gateJob).toContain("if: always()")
  })

  it("accepts successful full validation", () => {
    expect(runGate().status).toBe(0)
  })

  it.each(["true", "false"])("allows docs-only skips with desktop_changed=%s", (desktop) => {
    expect(
      runGate({
        "scope.outputs.docs_only": "true",
        "scope.outputs.desktop_changed": desktop,
        "check.result": "skipped",
        "desktop-artifact.result": "skipped",
      }).status,
    ).toBe(0)
  })

  it("allows unrelated code changes to skip docs and desktop", () => {
    expect(
      runGate({
        "scope.outputs.docs_changed": "false",
        "scope.outputs.desktop_changed": "false",
        "docs.result": "skipped",
        "desktop-artifact.result": "skipped",
      }).status,
    ).toBe(0)
  })

  it("keeps packaging required for desktop-only changes", () => {
    expect(
      runGate({ "scope.outputs.docs_changed": "false", "docs.result": "skipped" }).status,
    ).toBe(0)
  })

  it.each(["failure", "cancelled", "skipped", "neutral", ""])(
    "rejects scope %s even when all dependent validation is skipped",
    (result) => {
      expect(
        runGate({
          "scope.result": result,
          "check.result": "skipped",
          "docs.result": "skipped",
          "desktop-artifact.result": "skipped",
        }).status,
      ).toBe(1)
    },
  )

  it.each([
    "check",
    "docs",
    "desktop-artifact",
    "secrets",
    "gitleaks",
    "policy",
    "dependency-audit",
  ])("requires successful applicable %s validation", (job) => {
    for (const result of ["failure", "cancelled", "skipped", "neutral", ""]) {
      expect(runGate({ [`${job}.result`]: result }).status, `${job}: ${result}`).toBe(1)
    }
  })

  it.each(["docs_only", "docs_changed", "desktop_changed"])(
    "rejects unknown or missing %s even with successful jobs",
    (flag) => {
      for (const value of ["", "unknown", "True"]) {
        expect(runGate({ [`scope.outputs.${flag}`]: value }).status).toBe(1)
      }
    },
  )

  it("rejects contradictory docs-only scope", () => {
    expect(
      runGate({ "scope.outputs.docs_only": "true", "scope.outputs.docs_changed": "false" }).status,
    ).toBe(1)
  })

  it("does not allow a failed optional job to masquerade as a skip", () => {
    expect(
      runGate({
        "scope.outputs.docs_changed": "false",
        "scope.outputs.desktop_changed": "false",
        "docs.result": "failure",
        "desktop-artifact.result": "cancelled",
      }).status,
    ).toBe(1)
  })
})

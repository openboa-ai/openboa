import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const scriptPath = join(process.cwd(), "scripts", "validate-latency-evidence.mjs")
const passingFixturePath = join(process.cwd(), "test", "fixtures", "queue-latency-regression.jsonl")
const failingFixturePath = join(process.cwd(), "test", "fixtures", "queue-latency-invalid.jsonl")

describe("latency evidence validator", () => {
  it("accepts the canonical queue latency evidence fixture", async () => {
    const { stdout } = await execFileAsync("node", [scriptPath, passingFixturePath])

    expect(stdout).toContain("latency-evidence-validation=PASS")
    expect(stdout).toContain("records=20")
  })

  it("fails when a required field is missing", async () => {
    await expect(execFileAsync("node", [scriptPath, failingFixturePath])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "latency-evidence-validation=FAIL reason=line 1 missing required field: first_worker_ack_at",
      ),
    })
  })
})

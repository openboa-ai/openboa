import { execFile } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const scriptPath = join(process.cwd(), "scripts", "check-queue-latency.mjs")
const fixturePath = join(process.cwd(), "test", "fixtures", "queue-latency-regression.jsonl")

describe("queue latency gate", () => {
  it("produces deterministic pass metrics for the regression fixture", async () => {
    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "--input",
      fixturePath,
      "--window-size",
      "10",
      "--threshold-ms",
      "3000",
    ])

    expect(stdout).toContain("status=PASS")
    expect(stdout).toContain("samples=20")
    expect(stdout).toContain("samples=20")
    expect(stdout).toContain("full_run_p95_ms=2600")
    expect(stdout).toContain("rolling_window_p95_ms=2950")
  })

  it("fails when the deterministic p95 threshold is exceeded", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "queue-latency-fixture-"))
    const failingFixturePath = join(tempDir, "failing.jsonl")
    await writeFile(
      failingFixturePath,
      [
        {
          task_id: "task-1",
          task_enqueued_at: "2026-03-01T00:00:00.000Z",
          first_worker_ack_at: "2026-03-01T00:00:03.500Z",
        },
        {
          task_id: "task-2",
          task_enqueued_at: "2026-03-01T00:00:01.000Z",
          first_worker_ack_at: "2026-03-01T00:00:04.600Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    )

    await expect(
      execFileAsync("node", [
        scriptPath,
        "--input",
        failingFixturePath,
        "--window-size",
        "2",
        "--threshold-ms",
        "3000",
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("status=FAIL"),
    })
  })

  it("fails when the evidence fixture is missing a required field", async () => {
    await expect(
      execFileAsync("node", [
        scriptPath,
        "--input",
        join(process.cwd(), "test", "fixtures", "queue-latency-invalid.jsonl"),
        "--window-size",
        "1",
        "--threshold-ms",
        "3000",
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "queue-latency-check-error=line 1 missing required field: first_worker_ack_at",
      ),
    })
  })
})

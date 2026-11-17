import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, it } from "vitest"

const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve("markdownlint-cli2")), "markdownlint-cli2-bin.mjs")

it("preserves TOML per-rule options through the actual docs linter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openboa-toml-"))
  try {
    const config = join(directory, ".markdownlint-cli2.jsonc")
    await writeFile(config, JSON.stringify({ config: { default: false, MD013: true } }))
    const line = `${"word ".repeat(20).trim()}\n`
    const controls = [
      { name: "default", inline: "", expected: 1 },
      {
        name: "json",
        inline: '<!-- markdownlint-configure-file {"MD013":{"line_length":120}} -->\n',
        expected: 0,
      },
      {
        name: "toml",
        inline: "<!-- markdownlint-configure-file MD013={line_length=120} -->\n",
        expected: 0,
      },
    ]
    for (const control of controls) {
      const file = join(directory, `${control.name}.md`)
      await writeFile(file, `${control.inline}# Fixture\n\n${line}`)
      const result = spawnSync(process.execPath, [cli, "--config", config, file], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(control.expected)
      if (control.expected !== 0) {
        expect(result.stderr).toContain("Expected: 80; Actual: 99")
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

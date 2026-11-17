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
      {
        name: "toml-disabled",
        inline: "<!-- markdownlint-configure-file MD013={enabled=false} -->\n",
        expected: 0,
      },
      {
        name: "toml-warning",
        inline: '<!-- markdownlint-configure-file MD013={line_length=80,severity="warning"} -->\n',
        expected: 0,
        warning: true,
      },
      {
        name: "yaml",
        inline: "<!-- markdownlint-configure-file MD013: {line_length: 120} -->\n",
        expected: 0,
      },
      {
        name: "primitive-disabled",
        inline: '<!-- markdownlint-configure-file {"MD013":false} -->\n',
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
      if ("warning" in control) {
        expect(result.stderr).toContain("warning MD013")
      }
    }

    const tomlConfig = join(directory, "pyproject.toml")
    await rm(config)
    await writeFile(
      tomlConfig,
      "[tool.markdownlint-cli2.config]\ndefault=false\n[tool.markdownlint-cli2.config.MD013]\nline_length=120\n",
    )
    const file = join(directory, "nested-table.md")
    await writeFile(file, `# Fixture\n\n${line}`)
    const nested = spawnSync(
      process.execPath,
      [cli, "--config", tomlConfig, "--configPointer", "/tool/markdownlint-cli2", file],
      { cwd: directory, encoding: "utf8", timeout: 5000 },
    )
    expect(nested.error).toBeUndefined()
    expect(nested.status, nested.stdout + nested.stderr).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

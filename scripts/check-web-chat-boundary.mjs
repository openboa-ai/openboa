import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMPORT_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu

export const DEFAULT_WEB_CHAT_BANNED_IMPORT_PREFIXES = [
  "src/shared/company-model",
  "src/shell/web/components/shared/presentation",
  "src/shell/web/components/work/",
  "src/shell/web/components/observe/",
  "src/shell/web/demo-shell",
]

async function listSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.resolve(root, entry.name)
      if (entry.isDirectory()) {
        return await listSourceFiles(fullPath)
      }
      return entry.isFile() && [".ts", ".tsx", ".mts"].includes(path.extname(entry.name))
        ? [fullPath]
        : []
    }),
  )
  return files.flat()
}

function resolveImportTarget(repoRoot, filePath, specifier) {
  if (!specifier.startsWith(".")) {
    return null
  }

  const resolved = path.resolve(path.dirname(filePath), specifier)
  const repoRelative = path.relative(repoRoot, resolved).replaceAll("\\", "/")
  return repoRelative.length > 0 ? repoRelative : null
}

export async function findWebChatImportBoundaryViolations(options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(__dirname, "..")
  const bannedPrefixes = options.bannedPrefixes ?? DEFAULT_WEB_CHAT_BANNED_IMPORT_PREFIXES
  const roots = options.roots ?? [
    path.resolve(repoRoot, "src/shell/web/chat-app-state.ts"),
    path.resolve(repoRoot, "src/shell/web/ChatApp.tsx"),
    path.resolve(repoRoot, "src/shell/web/ChatStandaloneApp.tsx"),
    path.resolve(repoRoot, "src/shell/web/chat/main.tsx"),
    path.resolve(repoRoot, "src/shell/web/chat-seed.ts"),
    path.resolve(repoRoot, "src/shell/web/components/chrome/global-bar.tsx"),
    path.resolve(repoRoot, "src/shell/web/components/chat"),
  ]

  const files = (
    await Promise.all(
      roots.map(async (root) => {
        const stats = await stat(root)
        return stats.isDirectory() ? await listSourceFiles(root) : [root]
      }),
    )
  ).flat()

  const violations = []

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8")
    const relativeFile = path.relative(repoRoot, filePath).replaceAll("\\", "/")

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1]
      if (!specifier || specifier.startsWith("node:")) {
        continue
      }

      const target = resolveImportTarget(repoRoot, filePath, specifier)
      if (!target) {
        continue
      }

      if (bannedPrefixes.some((prefix) => target.startsWith(prefix))) {
        violations.push({
          file: relativeFile,
          specifier,
          target,
        })
      }
    }
  }

  return violations
}

export async function assertWebChatImportBoundary(options = {}) {
  const violations = await findWebChatImportBoundaryViolations(options)
  if (violations.length === 0) {
    return
  }

  const rendered = violations
    .map((violation) => `${violation.file} -> ${violation.specifier} (${violation.target})`)
    .join("\n")
  throw new Error(`web chat import boundary violations detected:\n${rendered}`)
}

if (process.argv[1] === __filename) {
  try {
    await assertWebChatImportBoundary()
    console.log("Web chat import boundary passed.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

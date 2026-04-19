import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const DEFAULT_ALLOWED_CHAT_IMPORT_PREFIXES = ["src/chat/", "src/foundation/"]
const IMPORT_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu

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

export async function findChatImportBoundaryViolations(options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(__dirname, "..")
  const chatRoot = path.resolve(repoRoot, "src/chat")
  const allowedPrefixes = options.allowedPrefixes ?? DEFAULT_ALLOWED_CHAT_IMPORT_PREFIXES

  const files = await listSourceFiles(chatRoot)
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

      if (!allowedPrefixes.some((prefix) => target.startsWith(prefix))) {
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

export async function assertChatImportBoundary(options = {}) {
  const violations = await findChatImportBoundaryViolations(options)
  if (violations.length === 0) {
    return
  }

  const rendered = violations
    .map((violation) => `${violation.file} -> ${violation.specifier} (${violation.target})`)
    .join("\n")
  throw new Error(`chat import boundary violations detected:\n${rendered}`)
}

if (process.argv[1] === __filename) {
  try {
    await assertChatImportBoundary()
    console.log("Chat import boundary passed.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const DEFAULT_CHAT_LEGACY_NAMING_PATTERNS = [
  {
    label: "legacy Company* chat alias",
    pattern:
      /\bChat[A-Za-z0-9_]+\s+as\s+Company[A-Za-z0-9_]+\b|\bCompany(?:Conversation|Cursor|DmGroup|GrantBinding|GrantScopeKind|LedgerEvent|Message|Participant(?:Kind|Record|Ref|UpsertInput)?|RoleId|Room(?:Kind|Membership(?:Input|Record|State)?)|SystemEventKind)\b/gu,
  },
  {
    label: "legacy OpenboaChat* alias",
    pattern: /\bChat[A-Za-z0-9_]+\s+as\s+OpenboaChat[A-Za-z0-9_]+\b|\bOpenboaChat[A-Za-z0-9_]+\b/gu,
  },
  {
    label: "chat type re-export through company-model",
    pattern: /\bexport\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+["']\.\.\/chat\//gu,
  },
  {
    label: "legacy non-chat admin naming",
    pattern:
      /\bcompany_admin\b|\bcompany\.grant\.manage\b|\bworkspace_admin\b|\bworkspace\.grant\.manage\b/gu,
  },
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

export async function findChatLegacyNamingViolations(options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(__dirname, "..")
  const roots = options.roots ?? [
    path.resolve(repoRoot, "src/chat"),
    path.resolve(repoRoot, "src/shell/chat"),
    path.resolve(repoRoot, "src/shell/web/chat-app-state.ts"),
    path.resolve(repoRoot, "src/shell/web/chat-seed.ts"),
    path.resolve(repoRoot, "src/shell/web/components/chat"),
    path.resolve(repoRoot, "src/shared/company-model.ts"),
  ]
  const patterns = options.patterns ?? DEFAULT_CHAT_LEGACY_NAMING_PATTERNS

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

    for (const { label, pattern } of patterns) {
      const matches = Array.from(source.matchAll(pattern))
      for (const match of matches) {
        violations.push({
          file: relativeFile,
          label,
          match: match[0],
        })
      }
    }
  }

  return violations
}

export async function assertChatLegacyNaming(options = {}) {
  const violations = await findChatLegacyNamingViolations(options)
  if (violations.length === 0) {
    return
  }

  const rendered = violations
    .map((violation) => `${violation.file}: ${violation.label} -> ${violation.match}`)
    .join("\n")
  throw new Error(`chat legacy naming violations detected:\n${rendered}`)
}

if (process.argv[1] === __filename) {
  try {
    await assertChatLegacyNaming()
    console.log("Chat legacy naming guard passed.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

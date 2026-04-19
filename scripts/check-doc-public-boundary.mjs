import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const docsRoot = path.join(root, "docs")
const docsConfigPath = path.join(docsRoot, "docs.json")

const walkMarkdownFiles = (dir) => {
  if (!fs.existsSync(dir)) {
    return []
  }

  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkMarkdownFiles(absolute))
      continue
    }
    if (entry.isFile() && absolute.endsWith(".md")) {
      result.push(absolute)
    }
  }
  return result
}

const isPublicDocsPage = (filePath) => {
  const relative = path.relative(root, filePath).replaceAll(path.sep, "/")
  if (!relative.startsWith("docs/")) {
    return false
  }
  if (relative === "docs/README.md") {
    return false
  }
  return !relative.endsWith("/AGENTS.md") && !relative.endsWith("AGENTS.md")
}

const markdownFiles = walkMarkdownFiles(docsRoot).filter(isPublicDocsPage)
const issues = []

const docsAgentsFiles = walkMarkdownFiles(docsRoot).filter((filePath) => {
  const relative = path.relative(root, filePath).replaceAll(path.sep, "/")
  return (
    relative === "docs/AGENTS.md" ||
    (relative.startsWith("docs/") && relative.endsWith("/AGENTS.md"))
  )
})

for (const filePath of docsAgentsFiles) {
  issues.push({
    type: "public-doc-agents-file",
    file: path.relative(root, filePath),
    detail: "docs/**/AGENTS.md must not exist in the published docs tree.",
  })
}

const bannedLinkPatterns = [
  /]\((?:\/)?wiki(?:\/|[)#?])/g,
  /]\((?:\.\.\/)+wiki(?:\/|[)#?])/g,
  /]\((?:\/)?raw(?:\/|[)#?])/g,
  /]\((?:\.\.\/)+raw(?:\/|[)#?])/g,
]

for (const filePath of markdownFiles) {
  const content = fs.readFileSync(filePath, "utf8")
  for (const pattern of bannedLinkPatterns) {
    pattern.lastIndex = 0
    if (pattern.test(content)) {
      issues.push({
        type: "public-doc-link",
        file: path.relative(root, filePath),
        detail: "Public docs must not link to internal wiki/ or raw/ paths.",
      })
    }
  }
}

if (fs.existsSync(docsConfigPath)) {
  const docsConfig = JSON.parse(fs.readFileSync(docsConfigPath, "utf8"))
  const configText = JSON.stringify(docsConfig)
  if (/"(?:wiki|raw)(?:\/|")/.test(configText) || /\/(?:wiki|raw)(?:\/|")/.test(configText)) {
    issues.push({
      type: "docs-config-boundary",
      file: path.relative(root, docsConfigPath),
      detail: "docs.json must not route to internal wiki/ or raw/ content.",
    })
  }
}

if (issues.length > 0) {
  console.error("Docs public/internal boundary violations found:")
  for (const issue of issues) {
    console.error(`- [${issue.type}] ${issue.file}: ${issue.detail}`)
  }
  process.exit(1)
}

console.log("Docs public/internal boundary passed.")

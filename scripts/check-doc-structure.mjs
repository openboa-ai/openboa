import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const docsRoot = path.join(root, "docs")
const docsConfigPath = path.join(docsRoot, "docs.json")

const collectPages = (node, pages) => {
  if (!node) {
    return
  }

  if (typeof node === "string") {
    pages.add(node)
    return
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectPages(item, pages)
    }
    return
  }

  for (const key of ["pages", "groups", "tabs", "anchors", "dropdowns", "menu", "languages"]) {
    if (key in node) {
      collectPages(node[key], pages)
    }
  }
}

const titleForPage = (content) => {
  const frontmatterTitle = content.match(/^title:\s*"(.+)"\s*$/m)?.[1]?.trim()
  if (frontmatterTitle) {
    return frontmatterTitle
  }

  const headingTitle = content.match(/^#\s+(.+)\s*$/m)?.[1]?.trim()
  if (headingTitle) {
    return headingTitle
  }

  return null
}

if (!fs.existsSync(docsConfigPath)) {
  console.error(`Missing docs config: ${path.relative(root, docsConfigPath)}`)
  process.exit(1)
}

const docsConfig = JSON.parse(fs.readFileSync(docsConfigPath, "utf8"))
const pages = new Set()
collectPages(docsConfig.navigation, pages)

const issues = []

for (const page of [...pages].sort((left, right) => left.localeCompare(right))) {
  const filePath = path.join(docsRoot, `${page}.md`)
  const relative = path.relative(root, filePath)
  if (!fs.existsSync(filePath)) {
    issues.push(`missing docs page for route "${page}" (${relative})`)
    continue
  }

  const title = titleForPage(fs.readFileSync(filePath, "utf8"))
  if (!title) {
    issues.push(`missing title/frontmatter heading for route "${page}" (${relative})`)
  }
}

if (issues.length > 0) {
  console.error("Docs structure validation failed:")
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log(`Docs structure validation passed for ${pages.size} routed pages.`)

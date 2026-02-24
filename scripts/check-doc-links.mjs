import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

const walkMarkdownFiles = (dir) => {
  if (!fs.existsSync(dir)) {
    return []
  }

  const result = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
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

const markdownFiles = [path.join(root, "README.md"), ...walkMarkdownFiles(path.join(root, "docs"))]

const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g
const missingLinks = []

for (const filePath of markdownFiles) {
  if (!fs.existsSync(filePath)) {
    continue
  }

  const content = fs.readFileSync(filePath, "utf8")
  for (let match = linkPattern.exec(content); match !== null; match = linkPattern.exec(content)) {
    let rawTarget = match[1].trim()
    if (rawTarget.startsWith("<") && rawTarget.endsWith(">")) {
      rawTarget = rawTarget.slice(1, -1)
    }

    const spaceIndex = rawTarget.search(/\s/)
    if (spaceIndex >= 0) {
      rawTarget = rawTarget.slice(0, spaceIndex)
    }

    if (
      rawTarget === "" ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("mailto:") ||
      rawTarget.startsWith("tel:")
    ) {
      continue
    }

    const targetWithoutAnchor = rawTarget.split("#")[0].split("?")[0]
    if (!targetWithoutAnchor) {
      continue
    }

    const resolvedPath = path.resolve(
      path.dirname(filePath),
      decodeURIComponent(targetWithoutAnchor),
    )
    if (!fs.existsSync(resolvedPath)) {
      missingLinks.push({
        file: path.relative(root, filePath),
        link: rawTarget,
        resolved: path.relative(root, resolvedPath),
      })
    }
  }
}

if (missingLinks.length > 0) {
  console.error("Broken local markdown links found:")
  for (const item of missingLinks) {
    console.error(`- ${item.file}: ${item.link} (resolved: ${item.resolved})`)
  }
  process.exit(1)
}

console.log("Local markdown links are valid.")

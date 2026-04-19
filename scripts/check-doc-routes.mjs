import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const repoRoot = process.cwd()
const docsConfigPath = path.join(repoRoot, "docs", "docs.json")
const docsRoot = path.join(repoRoot, "docs")

function parseArgs(argv) {
  let baseUrl = process.env.DOCS_BASE_URL ?? "http://localhost:3000"

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base-url") {
      baseUrl = argv[index + 1] ?? baseUrl
      index += 1
    }
  }

  return { baseUrl: baseUrl.replace(/\/+$/, "") }
}

function collectPages(node, pages) {
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

function routeForPage(page) {
  if (page === "index") {
    return "/"
  }

  if (page.endsWith("/index")) {
    return `/${page.slice(0, -"/index".length)}`
  }

  return `/${page}`
}

async function expectedTitleForPage(page) {
  const filePath = path.join(docsRoot, `${page}.md`)
  const content = await readFile(filePath, "utf8")
  const frontmatterTitle = content.match(/^title:\s*"(.+)"\s*$/m)?.[1]
  if (frontmatterTitle) {
    return frontmatterTitle
  }

  const headingTitle = content.match(/^#\s+(.+)\s*$/m)?.[1]
  if (headingTitle) {
    return headingTitle
  }

  throw new Error(`Could not determine expected title for ${page}`)
}

async function fetchRoute(baseUrl, route) {
  const url = `${baseUrl}${route.path}`
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "text/html",
      },
    })
    const body = await response.text()
    const titleFound = body.includes(route.title)
    const matchedMarker =
      !titleFound && body.includes("Page not found!")
        ? "Page not found!"
        : !titleFound &&
            body.includes("An unexpected error occurred. Please contact support to get help.")
          ? "An unexpected error occurred. Please contact support to get help."
          : null

    return {
      url,
      ok: response.ok && titleFound && !matchedMarker,
      status: response.status,
      matchedMarker,
      error: null,
      titleFound,
      expectedTitle: route.title,
    }
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      matchedMarker: null,
      error: error instanceof Error ? error.message : String(error),
      titleFound: false,
      expectedTitle: route.title,
    }
  }
}

async function main() {
  const { baseUrl } = parseArgs(process.argv.slice(2))
  const docsConfig = JSON.parse(await readFile(docsConfigPath, "utf8"))
  const pages = new Set()

  collectPages(docsConfig.navigation, pages)

  const routes = await Promise.all(
    [...pages]
      .sort((left, right) => left.localeCompare(right))
      .map(async (page) => ({
        page,
        path: routeForPage(page),
        title: await expectedTitleForPage(page),
      })),
  )
  const failures = []

  for (const route of routes) {
    const result = await fetchRoute(baseUrl, route)
    if (!result.ok) {
      failures.push(result)
      continue
    }

    console.log(`ok ${result.status} ${result.url}`)
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      const reason = failure.matchedMarker
        ? `rendered Mintlify error marker: ${failure.matchedMarker}`
        : failure.error
          ? `request failed: ${failure.error}`
          : !failure.titleFound
            ? `response did not include expected title: ${failure.expectedTitle}`
            : `unexpected status ${failure.status}`
      console.error(`fail ${failure.url} (${reason})`)
    }
    process.exitCode = 1
    return
  }

  console.log(`checked ${routes.length} docs routes against ${baseUrl}`)
}

await main()

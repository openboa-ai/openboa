import path from "node:path"
import { fileURLToPath } from "node:url"

const STANDARD_PR_TITLE_PATTERN = /^(feat|fix|docs|chore|refactor|test|ci|build|perf|revert): .+/
const DEPENDABOT_PR_TITLE_PATTERN =
  /^(?:build\(deps(?:-dev)?\): .+|bump .+ from .+ to .+)$/i
const REQUIRED_BODY_SECTIONS = ["Summary", "Checklist", "Validation", "Related"]

function hasSection(body, section) {
  return new RegExp(`^##\\s+${section}\\b`, "m").test(body)
}

export function validatePrConvention({ title, body, author }) {
  const normalizedTitle = typeof title === "string" ? title.trim() : ""
  const normalizedBody = typeof body === "string" ? body : ""
  const normalizedAuthor = typeof author === "string" ? author.trim() : ""
  const errors = []

  const isDependabot = normalizedAuthor === "dependabot[bot]"

  if (isDependabot) {
    if (!DEPENDABOT_PR_TITLE_PATTERN.test(normalizedTitle)) {
      errors.push("Dependabot PR title must match 'build(deps): ...' or 'Bump ... from ... to ...'")
    }

    return errors
  }

  if (!STANDARD_PR_TITLE_PATTERN.test(normalizedTitle)) {
    errors.push("PR title must match: type: description")
  }

  for (const section of REQUIRED_BODY_SECTIONS) {
    if (!hasSection(normalizedBody, section)) {
      errors.push(`Missing section: ## ${section}`)
    }
  }

  return errors
}

const __filename = fileURLToPath(import.meta.url)

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const eventPath = process.env.GITHUB_EVENT_PATH

  if (!eventPath) {
    console.error("PR convention check failed: GITHUB_EVENT_PATH is not set.")
    process.exit(1)
  }

  const fs = await import("node:fs/promises")
  const event = JSON.parse(await fs.readFile(eventPath, "utf8"))
  const title = event.pull_request?.title ?? ""
  const body = event.pull_request?.body ?? ""
  const author = event.pull_request?.user?.login ?? ""
  const errors = validatePrConvention({ title, body, author })

  if (errors.length > 0) {
    for (const error of errors) {
      if (error.startsWith("Missing section:")) {
        console.error(`::error title=PR body convention::${error}`)
      } else {
        console.error(`::error title=PR title convention::${error}`)
      }
    }
    console.error(`PR convention check failed with ${errors.length} error(s).`)
    process.exit(1)
  }

  console.log("PR convention check passed.")
}

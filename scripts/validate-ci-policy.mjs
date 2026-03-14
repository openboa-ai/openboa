import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const DEFAULT_MAX_EXCEPTION_SLA_DAYS = 14

function parseJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function parseIsoDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`)
  }

  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} is not a valid date`)
  }

  return parsed
}

function dayDiff(start, end) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay)
}

export function validateCodeowners(content) {
  const owners = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  if (owners.length === 0) {
    throw new Error("CODEOWNERS must define at least one ownership rule")
  }

  if (content.includes("@<owner-or-team>")) {
    throw new Error("CODEOWNERS still contains the placeholder @<owner-or-team>")
  }
}

export function validateCiExceptions(config, now = new Date()) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("ci-exceptions config must be a JSON object")
  }

  const slaDays = config.slaDays ?? DEFAULT_MAX_EXCEPTION_SLA_DAYS
  if (!Number.isInteger(slaDays) || slaDays <= 0) {
    throw new Error("ci-exceptions.slaDays must be a positive integer")
  }

  const exceptions = config.exceptions ?? []
  if (!Array.isArray(exceptions)) {
    throw new Error("ci-exceptions.exceptions must be an array")
  }

  exceptions.forEach((entry, index) => {
    const label = `exceptions[${index}]`
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`)
    }

    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      throw new Error(`${label}.id must be a non-empty string`)
    }

    if (typeof entry.owner !== "string" || !/^@[\w-]+(?:\/[\w-]+)?$/.test(entry.owner)) {
      throw new Error(`${label}.owner must be a GitHub @user or @org/team`)
    }

    const openedOn = parseIsoDate(entry.openedOn, `${label}.openedOn`)
    const expiresOn = parseIsoDate(entry.expiresOn, `${label}.expiresOn`)
    const durationDays = dayDiff(openedOn, expiresOn)

    if (durationDays < 0) {
      throw new Error(`${label}.expiresOn must be on or after openedOn`)
    }

    if (durationDays > slaDays) {
      throw new Error(`${label} exceeds the ${slaDays}-day exception SLA`)
    }

    if (dayDiff(now, expiresOn) < 0) {
      throw new Error(`${label} expired on ${entry.expiresOn}`)
    }

    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      throw new Error(`${label}.reason must explain the exception in at least 10 characters`)
    }

    if (typeof entry.trackingIssue !== "string" || entry.trackingIssue.trim().length === 0) {
      throw new Error(`${label}.trackingIssue must reference the follow-up issue or PR`)
    }
  })
}

export function validateRepositoryPolicy({ codeownersPath, exceptionsPath, now = new Date() }) {
  validateCodeowners(readFileSync(codeownersPath, "utf8"))
  validateCiExceptions(parseJsonFile(exceptionsPath), now)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.argv[1] === __filename) {
  const repoRoot = path.resolve(__dirname, "..")

  try {
    validateRepositoryPolicy({
      codeownersPath: path.join(repoRoot, ".github", "CODEOWNERS"),
      exceptionsPath: path.join(repoRoot, ".github", "ci-exceptions.json"),
    })
    console.log("CI policy validation passed.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`CI policy validation failed: ${message}`)
    process.exitCode = 1
  }
}

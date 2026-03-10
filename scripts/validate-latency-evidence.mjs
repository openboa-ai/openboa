#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

export function validateLatencyEvidenceRecord(record, schema, lineNumber) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`line ${lineNumber} must be a JSON object`)
  }

  const required = schema.required
  if (!Array.isArray(required)) {
    throw new Error("schema.required must be an array")
  }

  for (const field of required) {
    if (!(field in record)) {
      throw new Error(`line ${lineNumber} missing required field: ${field}`)
    }
  }

  return record
}

export async function loadLatencyEvidenceRecords(filePath) {
  const raw = await readFile(filePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => validateJsonLine(line, index + 1))
}

export async function loadLatencyEvidenceSchema(schemaPath) {
  const raw = await readFile(schemaPath, "utf8")
  const schema = JSON.parse(raw)

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("latency evidence schema must be a JSON object")
  }

  return schema
}

function validateJsonLine(line, lineNumber) {
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(`line ${lineNumber} is not valid JSON`)
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, "..")
  const inputPath =
    process.argv[2] ?? path.join(repoRoot, "test", "fixtures", "queue-latency-regression.jsonl")
  const schemaPath = process.argv[3] ?? path.join(repoRoot, "tools", "latency_evidence_schema.json")

  try {
    const [schema, records] = await Promise.all([
      loadLatencyEvidenceSchema(schemaPath),
      loadLatencyEvidenceRecords(inputPath),
    ])

    records.forEach((record, index) => {
      validateLatencyEvidenceRecord(record, schema, index + 1)
    })

    console.log(`latency-evidence-validation=PASS records=${records.length}`)
  } catch (error) {
    console.error(
      `latency-evidence-validation=FAIL reason=${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}

const __filename = fileURLToPath(import.meta.url)

if (process.argv[1] === __filename) {
  await main()
}

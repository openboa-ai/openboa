#!/usr/bin/env node

import process from "node:process"

import {
  loadLatencyEvidenceRecords,
  loadLatencyEvidenceSchema,
  validateLatencyEvidenceRecord,
} from "./validate-latency-evidence.mjs"

function parseArgs(argv) {
  const args = {
    input: null,
    thresholdMs: 3000,
    windowSize: 10,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (current === "--input") {
      args.input = argv[index + 1] ?? null
      index += 1
      continue
    }

    if (current === "--threshold-ms") {
      args.thresholdMs = Number(argv[index + 1] ?? "3000")
      index += 1
      continue
    }

    if (current === "--window-size") {
      args.windowSize = Number(argv[index + 1] ?? "10")
      index += 1
    }
  }

  if (!args.input) {
    throw new Error("missing required --input <file>")
  }

  if (!Number.isInteger(args.thresholdMs) || args.thresholdMs <= 0) {
    throw new Error("--threshold-ms must be a positive integer")
  }

  if (!Number.isInteger(args.windowSize) || args.windowSize <= 0) {
    throw new Error("--window-size must be a positive integer")
  }

  return args
}

function parseUtcTimestamp(value, fieldName) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(`${fieldName} must be a UTC ISO-8601 string with trailing Z`)
  }

  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} must be parseable`)
  }

  return parsed
}

function percentile95NearestRank(samples) {
  if (samples.length === 0) {
    throw new Error("cannot compute p95 for empty samples")
  }

  const sorted = [...samples].sort((left, right) => left - right)
  const rank = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, rank)]
}

function computeMetrics(latencies, windowSize) {
  if (latencies.length < windowSize) {
    throw new Error(`need at least ${windowSize} samples for rolling-window p95`)
  }

  const fullRunP95Ms = percentile95NearestRank(latencies)
  let rollingWindowP95Ms = 0

  for (let index = 0; index <= latencies.length - windowSize; index += 1) {
    const window = latencies.slice(index, index + windowSize)
    rollingWindowP95Ms = Math.max(rollingWindowP95Ms, percentile95NearestRank(window))
  }

  return {
    fullRunP95Ms,
    rollingWindowP95Ms,
  }
}

async function loadLatencies(filePath) {
  const schema = await loadLatencyEvidenceSchema(
    new URL("../tools/latency_evidence_schema.json", import.meta.url),
  )
  const records = await loadLatencyEvidenceRecords(filePath)

  return records.map((record, index) => {
    validateLatencyEvidenceRecord(record, schema, index + 1)
    const enqueuedAt = parseUtcTimestamp(
      record.task_enqueued_at,
      `line ${index + 1} task_enqueued_at`,
    )
    const ackAt = parseUtcTimestamp(
      record.first_worker_ack_at,
      `line ${index + 1} first_worker_ack_at`,
    )
    const latencyMs = ackAt - enqueuedAt

    if (latencyMs < 0) {
      throw new Error(`line ${index + 1} latency must be non-negative`)
    }

    return latencyMs
  })
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    const latencies = await loadLatencies(args.input)
    const metrics = computeMetrics(latencies, args.windowSize)
    const status =
      metrics.fullRunP95Ms <= args.thresholdMs && metrics.rollingWindowP95Ms <= args.thresholdMs
        ? "PASS"
        : "FAIL"

    console.log(`status=${status}`)
    console.log(`samples=${latencies.length}`)
    console.log(`threshold_ms=${args.thresholdMs}`)
    console.log(`window_size=${args.windowSize}`)
    console.log(`full_run_p95_ms=${metrics.fullRunP95Ms}`)
    console.log(`rolling_window_p95_ms=${metrics.rollingWindowP95Ms}`)

    process.exit(status === "PASS" ? 0 : 1)
  } catch (error) {
    console.error(
      `queue-latency-check-error=${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
}

await main()

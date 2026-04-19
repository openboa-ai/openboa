#!/usr/bin/env node
import { runCli } from "./index.js"

void runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${String((error as Error).message)}\n`)
  process.exitCode = 1
})

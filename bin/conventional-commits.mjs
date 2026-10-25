#!/usr/bin/env node
/**
 * `conventional-commits` command-line entry point.
 *
 * All work happens in `skills/conventional-commits/scripts/cli.mjs`, which has
 * no dependencies and can also be run directly from a checkout.
 */

import { run } from "../skills/conventional-commits/scripts/cli.mjs"

run().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)

#!/usr/bin/env node
/**
 * Claude Code `PreToolUse` hook.
 *
 * Claude Code passes one JSON object on stdin describing the tool call. A hook
 * that exits 2 blocks the call and shows stderr to the model, which is exactly
 * the behaviour strict commit enforcement needs.
 *
 * Configure it in `.claude/settings.json` (or a plugin's `hooks/hooks.json`):
 *
 *     {
 *       "hooks": {
 *         "PreToolUse": [
 *           {
 *             "matcher": "Bash",
 *             "hooks": [
 *               {
 *                 "type": "command",
 *                 "command": "node",
 *                 "args": ["${CLAUDE_PLUGIN_ROOT}/skills/conventional-commits/scripts/claude-hook.mjs"]
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     }
 *
 * The hook fails open: an unexpected payload or an internal error exits 0 so a
 * bug here cannot make every shell command fail. Only a real Conventional
 * Commits violation exits 2.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { checkShellCommand, formatBlockedMessage } from "./conventional-commits.mjs"

async function readStdin() {
  if (process.stdin.isTTY) return ""
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * @param {unknown} input
 * @returns {string | null}
 */
function readCommand(input) {
  if (!input || typeof input !== "object") return null
  const record = /** @type {Record<string, unknown>} */ (input)
  if (typeof record.command === "string") return record.command
  if (Array.isArray(record.command)) return record.command.map(String).join(" ")
  if (typeof record.cmd === "string") return record.cmd
  return null
}

/**
 * @returns {Promise<number>} exit code
 */
async function main() {
  const raw = await readStdin()
  if (!raw.trim()) return 0

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    // Another tool may reuse this hook path; do not block on foreign input.
    return 0
  }

  const toolName = String(payload?.tool_name ?? payload?.toolName ?? "")
  if (toolName && !/bash|shell|exec|command/i.test(toolName)) return 0

  const command = readCommand(payload?.tool_input ?? payload)
  if (!command || !command.includes("git")) return 0

  const cwd = typeof payload?.cwd === "string" ? payload.cwd : process.cwd()
  const result = checkShellCommand(command, {
    readFile: (path) => {
      try {
        return readFileSync(resolve(cwd, path), "utf8")
      } catch {
        return null
      }
    },
  })

  if (!result.blocked) return 0
  process.stderr.write(`${formatBlockedMessage(result)}\n`)
  return 2
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    // Fail open: an internal error must not block unrelated shell commands.
    process.exitCode = 0
  },
)

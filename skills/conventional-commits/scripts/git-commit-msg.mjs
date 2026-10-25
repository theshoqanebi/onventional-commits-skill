#!/usr/bin/env node
/**
 * Git `commit-msg` hook.
 *
 * Git passes the path to the message file (`$1`, normally `.git/COMMIT_EDITMSG`).
 * Exiting non-zero aborts the commit, so this is the last line of defence for
 * agents and editors that bypass an in-agent hook.
 *
 * Install it with `node scripts/install.mjs` or `npx conventional-commits-skill install-hooks`.
 *
 * The hook deliberately ignores comment lines because git strips them only
 * after this hook runs. A user who writes the message in an editor is judged on
 * what git will actually record.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { SPEC_URL, formatValidation, validateCommit } from "./conventional-commits.mjs"

/** Git's default comment character; `core.commentChar` is not worth a subprocess here. */
const COMMENT_RE = /^\s*#/

/**
 * Remove what git will remove: the comment block, the verbose diff section, and
 * the blank lines git pads the file with. Keep everything else byte-for-byte so
 * rule 6 (the blank line after the description) is still observable.
 *
 * @param {string} source
 */
export function cleanMessage(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const kept = []
  for (const line of lines) {
    if (/^# -+ >8 -+$/.test(line)) break
    if (COMMENT_RE.test(line)) continue
    kept.push(line)
  }
  while (kept.length > 0 && kept[0].trim() === "") kept.shift()
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop()
  return kept.join("\n")
}

const invokedDirectly =
  typeof process.argv[1] === "string" && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write("commit-msg hook: expected the path to the commit message file.\n")
    process.exit(2)
  }

  let source
  try {
    source = readFileSync(resolve(process.cwd(), file), "utf8")
  } catch (error) {
    process.stderr.write(
      `commit-msg hook: could not read "${file}": ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(2)
  }

  // An empty message means the user aborted the editor; let git cancel normally.
  const message = cleanMessage(source)
  if (!message.trim()) process.exit(0)

  const result = validateCommit(message)
  if (result.valid) process.exit(0)

  process.stderr.write(`\n${formatValidation(result)}\n\n`)
  process.stderr.write("The commit was not created. Rewrite the message and try again.\n")
  process.stderr.write(`Specification: ${SPEC_URL}\n\n`)
  process.exit(1)
}

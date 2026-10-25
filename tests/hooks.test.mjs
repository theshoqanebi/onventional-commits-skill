import test, { after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { cleanMessage } from "../skills/conventional-commits/scripts/git-commit-msg.mjs"

const SCRIPTS = fileURLToPath(new URL("../skills/conventional-commits/scripts/", import.meta.url))
const COMMIT_MSG = join(SCRIPTS, "git-commit-msg.mjs")
const CLAUDE_HOOK = join(SCRIPTS, "claude-hook.mjs")
const INSTALL = join(SCRIPTS, "install.mjs")

/** @type {string[]} */
const created = []

after(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  }
})

/** @param {string[]} args */
function git(args, cwd) {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
}

function makeRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "conventional-commits-hooks-"))
  created.push(cwd)
  git(["init", "-q", "--initial-branch=main"], cwd)
  return cwd
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 */
function node(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    input: options.input,
  })
}

test("cleanMessage removes comments and the verbose diff", () => {
  const source = [
    "# Please enter the commit message for your changes.",
    "",
    "feat: add parser",
    "",
    "It parses things.",
    "",
    "# ------------------------ >8 ------------------------",
    "diff --git a/x b/x",
    "# a comment that should be unreachable",
  ].join("\n")

  assert.equal(cleanMessage(source), "feat: add parser\n\nIt parses things.")
})

test("cleanMessage keeps the blank line that rule 6 requires", () => {
  assert.equal(cleanMessage("fix: handle empty scope\nbody without a blank line\n"), "fix: handle empty scope\nbody without a blank line")
})

test("commit-msg hook rejects a malformed message", () => {
  const cwd = makeRepo()
  writeFileSync(join(cwd, "message.txt"), "feat add parser\n")

  const result = node(COMMIT_MSG, ["message.txt"], { cwd })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /\[rule 1\]/)
  assert.match(result.stderr, /The commit was not created/)
})

test("commit-msg hook accepts a valid message and an aborted edit", () => {
  const cwd = makeRepo()
  writeFileSync(join(cwd, "valid.txt"), "fix(parser): handle empty scope\n")
  assert.equal(node(COMMIT_MSG, ["valid.txt"], { cwd }).status, 0)

  writeFileSync(join(cwd, "empty.txt"), "# Only comments; the user aborted.\n")
  assert.equal(node(COMMIT_MSG, ["empty.txt"], { cwd }).status, 0)
})

test("commit-msg hook reports a missing message file", () => {
  const cwd = makeRepo()
  const result = node(COMMIT_MSG, ["nope.txt"], { cwd })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /could not read "nope.txt"/)
})

test("installing the hook blocks a real invalid commit", () => {
  const cwd = makeRepo()
  const install = node(INSTALL, ["--dir", cwd])
  assert.equal(install.status, 0, install.stderr)
  assert.match(install.stdout, /Installed/)

  const hook = readFileSync(join(cwd, ".git", "hooks", "commit-msg"), "utf8")
  assert.match(hook, /conventional-commits-skill/)

  writeFileSync(join(cwd, "a.txt"), "one\n")
  git(["add", "a.txt"], cwd)

  const blocked = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "feat add parser"],
    { cwd, encoding: "utf8" },
  )
  assert.notEqual(blocked.status, 0)
  assert.match(blocked.stderr, /\[rule 1\]/)

  const accepted = git(["commit", "-m", "feat: add parser"], cwd)
  assert.match(accepted, /feat: add parser/)
})

test("installing refuses to replace a foreign hook without --force", () => {
  const cwd = makeRepo()
  const hookPath = join(cwd, ".git", "hooks", "commit-msg")
  writeFileSync(hookPath, "#!/bin/sh\nexit 0\n")

  const refused = node(INSTALL, ["--dir", cwd])
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /already exists/)

  const forced = node(INSTALL, ["--dir", cwd, "--force"])
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(readFileSync(hookPath, "utf8"), /conventional-commits-skill/)
})

test("uninstalling removes only hooks this tool installed", () => {
  const cwd = makeRepo()
  const hookPath = join(cwd, ".git", "hooks", "commit-msg")

  node(INSTALL, ["--dir", cwd])
  const removed = node(INSTALL, ["--dir", cwd, "--uninstall"])
  assert.equal(removed.status, 0, removed.stderr)
  assert.equal(existsSync(hookPath), false)

  writeFileSync(hookPath, "#!/bin/sh\nexit 0\n")
  const refused = node(INSTALL, ["--dir", cwd, "--uninstall"])
  assert.equal(refused.status, 1)
  assert.equal(existsSync(hookPath), true)
})

test("installing outside a repository fails with a hint", () => {
  const cwd = mkdtempSync(join(tmpdir(), "conventional-commits-norepo-"))
  created.push(cwd)
  const result = node(INSTALL, [], { cwd })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Not inside a git repository/)
})

test("claude hook blocks a bad command and allows everything else", () => {
  const blocked = node(CLAUDE_HOOK, [], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: 'git commit -m "nope"' } }),
  })
  assert.equal(blocked.status, 2)
  assert.match(blocked.stderr, /Commit blocked/)

  const allowed = node(CLAUDE_HOOK, [], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: 'git commit -m "fix: handle empty scope"' } }),
  })
  assert.equal(allowed.status, 0)

  const unrelated = node(CLAUDE_HOOK, [], {
    input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: "README.md" } }),
  })
  assert.equal(unrelated.status, 0)

  const foreign = node(CLAUDE_HOOK, [], { input: "not json" })
  assert.equal(foreign.status, 0)
})

test("claude hook reads the message file relative to the hook cwd", () => {
  const cwd = makeRepo()
  writeFileSync(join(cwd, "message.txt"), "feat add parser\n")

  const result = node(CLAUDE_HOOK, [], {
    cwd,
    input: JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command: "git commit -F message.txt" } }),
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /\[rule 1\]/)
})

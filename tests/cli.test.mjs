import test, { after } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const CLI = fileURLToPath(new URL("../skills/conventional-commits/scripts/cli.mjs", import.meta.url))

/** @type {string[]} */
const created = []

after(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  }
})

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function git(args, cwd) {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
}

/**
 * @param {string} cwd
 * @param {string} message
 */
function commit(cwd, message) {
  const file = join(cwd, "changes.txt")
  writeFileSync(file, `${message}\n`, { flag: "a" })
  git(["add", "changes.txt"], cwd)
  git(["commit", "-m", message], cwd)
}

/**
 * Create a repository whose history after `tag` is the given messages.
 *
 * @param {string[]} messages
 */
function makeRepo(messages = []) {
  const cwd = mkdtempSync(join(tmpdir(), "conventional-commits-cli-"))
  created.push(cwd)
  git(["init", "--initial-branch=main"], cwd)
  git(["commit", "--allow-empty", "-m", "chore: initial commit"], cwd)
  git(["tag", "v1.0.0"], cwd)
  for (const message of messages) commit(cwd, message)
  return cwd
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 */
function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, NO_COLOR: "1" },
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("validate accepts a conforming message and exits 0", () => {
  const result = cli(["validate", "-m", "feat(parser): add array support"])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /OK: message conforms/)
  assert.match(result.stdout, /type=feat scope=parser semver=minor/)
})

test("validate rejects a malformed message and exits 1", () => {
  const result = cli(["validate", "--message", "feat add parser"])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL: 1 problem/)
  assert.match(result.stdout, /This message would pass:\nfeat: add parser/)
})

test("validate reads a positional message and standard input", () => {
  const positional = cli(["validate", "fix: handle empty scope"])
  assert.equal(positional.code, 0, positional.stderr)

  const piped = cli(["validate", "--stdin"], { input: "docs: correct the setup steps\n" })
  assert.equal(piped.code, 0, piped.stderr)
  assert.match(piped.stdout, /type=docs/)
})

test("validate reads a message file and reports unreadable files", () => {
  const cwd = makeRepo()
  writeFileSync(join(cwd, "message.txt"), "build(deps): bump typescript to 5.7\n")

  const result = cli(["validate", "--file", "message.txt"], { cwd })
  assert.equal(result.code, 0, result.stderr)

  const missing = cli(["validate", "--file", "nope.txt"], { cwd })
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /Could not read "nope.txt"/)
})

test("validate requires a message", () => {
  const result = cli(["validate"])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /No message supplied/)
})

test("validate supports --json and --any-type", () => {
  const json = cli(["validate", "-m", "feat: add parser", "--json"])
  assert.equal(json.code, 0, json.stderr)
  const payload = JSON.parse(json.stdout)
  assert.equal(payload.valid, true)
  assert.equal(payload.bump, "minor")
  assert.equal(payload.parsed.type, "feat")

  const custom = cli(["validate", "-m", "deps: bump express", "--any-type"])
  assert.equal(custom.code, 0, custom.stderr)
})

test("check-command passes a conforming command and blocks a bad one", () => {
  const ok = cli(["check-command", "--command", 'git commit -m "fix: handle empty scope"'])
  assert.equal(ok.code, 0, ok.stderr)
  assert.match(ok.stdout, /OK: no commit message violations/)

  const blocked = cli(["check-command", "--command", 'git commit -m "feat add parser"'])
  assert.equal(blocked.code, 1)
  assert.match(blocked.stderr, /Commit blocked by conventional-commits/)
  assert.match(blocked.stderr, /\[rule 1\]/)
})

test("check-command exits 2 for Claude Code hooks", () => {
  const result = cli(["check-command", "--claude", "--command", 'git commit -m "nope"'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Commit blocked/)
})

test("check-command reads hook JSON from standard input", () => {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: 'git commit -m "feat add parser"' } })
  const result = cli(["check-command"], { input: payload })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /\[rule 1\]/)
})

test("check-command ignores commands without a git commit", () => {
  const result = cli(["check-command", "--command", "npm test"])
  assert.equal(result.code, 0, result.stderr)
})

test("bump recommends the highest SemVer change in the range", () => {
  const features = makeRepo(["feat(api): add pagination", "fix: handle empty scope"])
  assert.equal(cli(["bump"], { cwd: features }).stdout.trim(), "minor")

  const fixes = makeRepo(["fix: handle empty scope"])
  assert.equal(cli(["bump"], { cwd: fixes }).stdout.trim(), "patch")

  const breaking = makeRepo(["feat!: require Node 20"])
  assert.equal(cli(["bump"], { cwd: breaking }).stdout.trim(), "major")

  const empty = makeRepo()
  assert.equal(cli(["bump"], { cwd: empty }).stdout.trim(), "none")
})

test("bump reports the range as JSON", () => {
  const cwd = makeRepo(["feat: add pagination", "fix: handle empty scope"])
  const result = cli(["bump", "--json"], { cwd })
  assert.equal(result.code, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.bump, "minor")
  assert.equal(payload.commits, 2)
  assert.equal(payload.from, "v1.0.0")
  assert.equal(payload.to, "HEAD")
})

test("bump honours an explicit range", () => {
  const cwd = makeRepo(["feat: add pagination"])
  const head = git(["rev-parse", "HEAD"], cwd).trim()
  git(["tag", "v1.1.0"], cwd)
  commit(cwd, "fix: handle empty scope")

  assert.equal(cli(["bump", "--from", "v1.1.0"], { cwd }).stdout.trim(), "patch")
  assert.equal(cli(["bump", "--from", "v1.0.0", "--to", head], { cwd }).stdout.trim(), "minor")
})

test("changelog groups commits by type and headings", () => {
  const cwd = makeRepo(["feat(api): add pagination", "fix: handle empty scope", "docs: explain the retry policy"])
  const result = cli(["changelog", "--version", "1.1.0", "--date", "2026-01-02"], { cwd })
  assert.equal(result.code, 0, result.stderr)

  assert.match(result.stdout, /^## \[1\.1\.0\] - 2026-01-02$/m)
  assert.match(result.stdout, /### Features\n\n- \*\*api:\*\* add pagination \(\w{7}\)/)
  assert.match(result.stdout, /### Bug Fixes\n\n- handle empty scope \(\w{7}\)/)
  assert.match(result.stdout, /### Documentation\n\n- explain the retry policy/)
})

test("changelog can omit hashes and report JSON", () => {
  const cwd = makeRepo(["feat: add pagination"])
  const plain = cli(["changelog", "--no-hash"], { cwd })
  assert.equal(plain.code, 0, plain.stderr)
  assert.match(plain.stdout, /^## Unreleased$/m)
  assert.match(plain.stdout, /- add pagination$/m)
  assert.doesNotMatch(plain.stdout, /\([0-9a-f]{7}\)/)

  const json = cli(["changelog", "--json"], { cwd })
  const payload = JSON.parse(json.stdout)
  assert.equal(payload.bump, "minor")
  assert.equal(payload.commitCount, 1)
  assert.equal(payload.from, "v1.0.0")
  assert.equal(payload.breaking.length, 0)
})

test("changelog lists breaking changes first", () => {
  const cwd = makeRepo([
    `feat!: require Node 20

BREAKING CHANGE: Node 18 is no longer supported. Upgrade the runtime.`,
    "fix: handle empty scope",
  ])
  const result = cli(["changelog", "--version", "2.0.0", "--date", "2026-03-01"], { cwd })
  const breaking = result.stdout.indexOf("### Breaking Changes")
  const features = result.stdout.indexOf("### Features")
  assert.ok(breaking !== -1, result.stdout)
  assert.ok(breaking < features, "breaking changes should come first")
  assert.match(result.stdout, /Node 18 is no longer supported/)
})

test("suggest prints a mechanical repair", () => {
  const repaired = cli(["suggest", "-m", "feat add parser."])
  assert.equal(repaired.code, 0, repaired.stderr)
  assert.equal(repaired.stdout.trim(), "feat: add parser")

  const hopeless = cli(["suggest", "-m", "updated stuff"])
  assert.equal(hopeless.code, 1)
  assert.match(hopeless.stdout, /No mechanical fix is possible/)
})

test("unknown commands and options fail with exit 2", () => {
  assert.equal(cli(["nope"]).code, 2)
  assert.equal(cli(["validate", "--nope"]).code, 2)
  assert.equal(cli(["help"]).stdout.includes("conventional-commits"), true)
})

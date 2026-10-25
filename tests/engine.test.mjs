import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_TYPES,
  buildChangelog,
  checkShellCommand,
  extractGitCommitInvocations,
  formatBlockedMessage,
  formatValidation,
  parseCommit,
  recommendBump,
  suggestMessage,
  validateCommit,
} from "../skills/conventional-commits/scripts/conventional-commits.mjs"

const valid = (message, options) => {
  const result = validateCommit(message, options)
  assert.equal(result.valid, true, `expected valid:\n${message}\n${JSON.stringify(result.violations, null, 2)}`)
  return result
}

const invalid = (message, rule, options) => {
  const result = validateCommit(message, options)
  assert.equal(result.valid, false, `expected invalid: ${message}`)
  assert.ok(
    result.violations.some((problem) => problem.rule === rule),
    `expected rule ${rule}, got ${JSON.stringify(result.violations)}`,
  )
  return result
}

test("parses the header into type, scope, bang, and description", () => {
  const parsed = parseCommit("feat(parser)!: add array support")
  assert.equal(parsed.type, "feat")
  assert.equal(parsed.scope, "parser")
  assert.equal(parsed.breaking, true)
  assert.equal(parsed.description, "add array support")
})

test("accepts the core shapes from the specification", () => {
  const cases = [
    ["feat: allow provided config object to extend other configs", "minor"],
    ["docs: correct spelling of CHANGELOG", "patch"],
    ["feat(lang): add Polish language", "minor"],
    ["feat!: send an email to the customer when a product is shipped", "major"],
    ["feat(api)!: send an email to the customer when a product is shipped", "major"],
    ["build(deps): bump typescript to 5.7", "patch"],
    ["revert: let us never again speak of the noodle incident", "patch"],
  ]
  for (const [message, bump] of cases) {
    const result = valid(message)
    assert.equal(result.bump, bump, message)
  }
})

test("accepts a body and multiple footers", () => {
  const message = `fix: prevent racing of requests

Introduce a request id and a reference to latest request. Dismiss
incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
Refs: #123`
  const result = valid(message)
  assert.equal(result.parsed.body.includes("Introduce a request id"), true)
  assert.equal(result.parsed.footers.length, 2)
  assert.equal(result.parsed.footers[1].token, "Refs")
  assert.equal(result.parsed.footers[1].value, "#123")
})

test("accepts multi-line footer values", () => {
  const message = `feat: add config loader

BREAKING CHANGE: the environment variable now takes precedence
over the config file. Migrate by removing duplicates from the
config file.`
  const result = valid(message)
  assert.equal(result.parsed.breaking, true)
  assert.match(result.parsed.breakingDescription, /environment variable/)
})

test("accepts both breaking-change footer spellings", () => {
  for (const token of ["BREAKING CHANGE", "BREAKING-CHANGE"]) {
    const result = valid(`feat: change API\n\n${token}: callers must pass an id`)
    assert.equal(result.bump, "major")
  }
})

test("treats BREAKING CHANGE as breaking regardless of type", () => {
  const result = valid("chore: drop old tooling\n\nBREAKING CHANGE: the make target is gone")
  assert.equal(result.bump, "major")
})

test("rejects an empty message", () => {
  invalid("", 1)
  invalid("   \n\n", 1)
})

test("requires a type, colon, space, and description", () => {
  invalid("add parser", 1)
  invalid("feat add parser", 1)
  invalid("feat:add parser", 1)
  invalid("feat(parser) add parser", 1)
  invalid("feat: ", 5)
  invalid("feat:  add parser", 5)
})

test("reports a mechanical fix for common header mistakes", () => {
  assert.equal(suggestMessage("feat add parser"), "feat: add parser")
  assert.equal(suggestMessage("feat:add parser"), "feat: add parser")
  assert.equal(suggestMessage("feat(api) add parser"), "feat(api): add parser")
  assert.equal(suggestMessage("feat!(api): add parser"), "feat(api)!: add parser")
  assert.equal(suggestMessage("feat(): add parser"), "feat: add parser")
  assert.equal(suggestMessage("FEAT: add parser."), "feat: add parser")
})

test("rejects an empty scope and a misplaced bang", () => {
  invalid("feat(): add parser", 4)
  invalid("feat!(parser): add parser", 13)
})

test("requires a blank line before the body", () => {
  const result = invalid("feat: add parser\nit parses things", 6)
  assert.equal(result.parsed.structure, "missing-blank-line")
})

test("requires an uppercase BREAKING CHANGE footer", () => {
  invalid("feat: change API\n\nbreaking change: callers must pass an id", 15)
  invalid("feat: change API\n\nBreaking Change: callers must pass an id", 15)
  invalid("feat: change API\n\nBREAKING CHANGE : callers must pass an id", 12)
  invalid("feat: change API\n\nBREAKING CHANGE:", 12)
})

test("accepts ! without a footer because the description carries the breaking change", () => {
  const result = valid("feat!: change API")
  assert.equal(result.bump, "major")
  assert.equal(result.parsed.breaking, true)
  assert.equal(result.parsed.breakingDescription, "change API")
})

test("warns, but does not fail, on style preferences", () => {
  const result = valid("FEAT: Add parser.")
  assert.ok(result.warnings.some((warning) => warning.rule === 15))
  assert.ok(result.warnings.some((warning) => warning.rule === 5))

  const long = valid(`feat: ${"x".repeat(120)}`)
  assert.ok(long.warnings.some((warning) => warning.rule === 5))

  const enforced = validateCommit(`feat: ${"x".repeat(120)}`, { enforceHeaderLength: true })
  assert.equal(enforced.valid, false)
})

test("enforces the allowed-type list when one is supplied", () => {
  const defaultResult = invalid("feature: add parser", 14)
  assert.match(defaultResult.violations[0].message, /not an allowed type/)

  const custom = valid("deps: bump typescript", { types: ["feat", "fix", "deps"] })
  assert.equal(custom.bump, "patch")

  valid("anything: goes", { types: null })
})

test("supports a required scope policy", () => {
  invalid("feat: add parser", 4, { requireScope: true })
  valid("feat(parser): add parser", { requireScope: true })
})

test("warns when a footer is stranded in the body", () => {
  const result = valid("chore: tidy\n\nSome prose.\nReviewed-by: Z")
  assert.ok(result.warnings.some((warning) => warning.rule === 8))
})

test("warns when a footer token contains a space", () => {
  const result = valid("chore: tidy\n\nSome prose.\n\nReviewed by: Z")
  assert.ok(result.warnings.some((warning) => warning.rule === 9))
})

test("ignores merge, fixup, squash, and generated revert messages", () => {
  for (const message of [
    "Merge branch 'main' into feature",
    "Merge pull request #12 from acme/feature",
    'Revert "feat: add parser"',
    "fixup! feat: add parser",
    "squash! fix: typo",
    "amend! feat: add parser",
  ]) {
    const result = validateCommit(message)
    assert.equal(result.valid, true, message)
    assert.equal(result.ignored, true, message)
  }
})

test("ignores merge commits only while the policy allows it", () => {
  const result = validateCommit("Merge branch 'main'", { allowMergeCommits: false })
  assert.equal(result.valid, false)
})

test("recommends a bump across a set of commits", () => {
  assert.equal(recommendBump(["docs: typo", "fix: crash"]), "patch")
  assert.equal(recommendBump(["docs: typo", "feat: search"]), "minor")
  assert.equal(recommendBump(["feat: search", "fix!: change shapes"]), "major")
  assert.equal(recommendBump(["Merge branch 'main'"]), null)
})

test("builds grouped changelog markdown with breaking changes first", () => {
  const result = buildChangelog(
    [
      { message: "feat(parser): add array support", hash: "a1b2c3d4e5f6" },
      { message: "fix: handle empty scope", hash: "b1b2c3d" },
      { message: "chore: tidy", hash: "c1b2c3d" },
      { message: "feat!: drop Node 6\n\nBREAKING CHANGE: use ESM", hash: "d1b2c3d" },
      { message: "docs: update readme", hash: "e1b2c3d" },
      { message: "Merge branch 'main'", hash: "f1b2c3d" },
    ],
    { version: "1.0.0", date: "2026-10-25" },
  )

  assert.equal(result.bump, "major")
  assert.equal(result.commitCount, 5)
  assert.match(result.markdown, /^## \[1\.0\.0\] - 2026-10-25/)
  assert.ok(result.markdown.indexOf("### Breaking Changes") < result.markdown.indexOf("### Features"))
  assert.match(result.markdown, /\*\*parser:\*\* add array support \(a1b2c3d\)/)
  assert.match(result.markdown, /### Bug Fixes/)
  assert.doesNotMatch(result.markdown, /Merge branch/)
})

test("handles an empty changelog range", () => {
  const result = buildChangelog([], { version: "2.0.0" })
  assert.equal(result.bump, null)
  assert.match(result.markdown, /_No commits in this range\._/)
})

test("formats validation output with rule numbers and fixes", () => {
  const output = formatValidation(validateCommit("feat add parser"))
  assert.match(output, /FAIL: 1 problem/)
  assert.match(output, /\[rule 1\]/)
  assert.match(output, /fix: feat: add parser/)
})

test("extracts inline messages from git commit", () => {
  const invocations = extractGitCommitInvocations('git commit -m "fix: handle empty scope"')
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].kind, "inline")
  assert.equal(invocations[0].message, "fix: handle empty scope")
})

test("extracts message flags in their common spellings", () => {
  assert.equal(extractGitCommitInvocations('git commit --message="fix: x"')[0].message, "fix: x")
  assert.equal(extractGitCommitInvocations('git commit -m"fix: x"')[0].message, "fix: x")
  assert.equal(extractGitCommitInvocations('git commit -am "feat: x"')[0].message, "feat: x")
  assert.equal(extractGitCommitInvocations('git commit -a -m "feat: x"')[0].message, "feat: x")
  assert.equal(extractGitCommitInvocations('git commit -m "feat: x" -m "body text"')[0].message, "feat: x\n\nbody text")
})

test("finds git commit after prefixes, operators, and global flags", () => {
  assert.equal(extractGitCommitInvocations('sudo git commit -m "fix: x"').length, 1)
  assert.equal(extractGitCommitInvocations('FOO=1 git commit -m "fix: x"').length, 1)
  assert.equal(extractGitCommitInvocations('cd repo && git commit -m "fix: x"').length, 1)
  assert.equal(extractGitCommitInvocations('git -C repo commit -m "fix: x"').length, 1)
  assert.equal(extractGitCommitInvocations('git commit -m "fix: x" && git push').length, 1)
})

test("does not treat quoted or documented commands as real commits", () => {
  assert.equal(extractGitCommitInvocations('echo "git commit -m \'nope\'"').length, 0)
  assert.equal(extractGitCommitInvocations("echo 'run git commit later'").length, 0)

  const readme = `cat > README.md <<'EOF'
Run this to commit:
git commit -m "nope"
EOF`
  assert.equal(extractGitCommitInvocations(readme).length, 0)
})

test("reads a message from a heredoc passed to -F -", () => {
  const command = `git commit -F - <<'EOF'
feat: add parser

It parses things.
EOF`
  const invocations = extractGitCommitInvocations(command)
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].kind, "inline")
  assert.match(invocations[0].message, /^feat: add parser/)
})

test("treats --amend --no-edit and message reuse as already validated", () => {
  assert.equal(extractGitCommitInvocations("git commit --amend --no-edit")[0].kind, "reused")
  assert.equal(extractGitCommitInvocations("git commit -C HEAD")[0].kind, "reused")
  assert.equal(extractGitCommitInvocations("git commit --fixup HEAD")[0].kind, "reused")
})

test("blocks invalid commits and passes valid ones", () => {
  assert.equal(checkShellCommand('git commit -m "fix: handle empty scope"').blocked, false)

  const blocked = checkShellCommand('git commit -m "feat add parser"')
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.findings[0].kind, "invalid")

  const message = formatBlockedMessage(blocked)
  assert.match(message, /Commit blocked/)
  assert.match(message, /\[rule 1\]/)
  assert.match(message, /This message would pass:/)
  assert.match(message, /feat: add parser/)

  // An unknown first word must not be "repaired" into `updated: stuff`.
  const unknown = formatBlockedMessage(checkShellCommand('git commit -m "updated stuff"'))
  assert.doesNotMatch(unknown, /fix: updated: stuff/)
})

test("blocks a commit that hides its message from inspection", () => {
  const missing = checkShellCommand("git commit")
  assert.equal(missing.blocked, true)
  assert.equal(missing.findings[0].kind, "missing-message")

  const unknownFile = checkShellCommand("git commit -F message.txt", { readFile: () => null })
  assert.equal(unknownFile.blocked, true)
  assert.equal(unknownFile.findings[0].kind, "unverified-file")
})

test("validates a message file when a reader is available", () => {
  const good = checkShellCommand("git commit -F message.txt", { readFile: () => "feat: add parser" })
  assert.equal(good.blocked, false)

  const bad = checkShellCommand("git commit -F message.txt", { readFile: () => "nope" })
  assert.equal(bad.blocked, true)
})

test("blocks only the invalid commit in a chain", () => {
  const result = checkShellCommand('git commit -m "fix: ok" && git commit -m "not ok"')
  assert.equal(result.invocations.length, 2)
  assert.equal(result.findings.length, 1)
})

test("DEFAULT_TYPES covers the documented conventional types", () => {
  for (const type of ["feat", "fix", "build", "chore", "ci", "docs", "style", "refactor", "perf", "test", "revert"]) {
    assert.ok(DEFAULT_TYPES.includes(type), type)
  }
})

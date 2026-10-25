/**
 * Conventional Commits 1.0.0 engine.
 *
 * Dependency-free ESM. This file is the single source of truth for:
 *   - parsing a commit message into type / scope / description / body / footers
 *   - validating it against the 16 rules of the specification
 *   - recommending a Semantic Versioning bump
 *   - building grouped release notes
 *   - finding and validating `git commit` invocations inside a shell command
 *
 * It lives inside the skill so the skill directory stays portable: copy
 * `skills/conventional-commits/` anywhere and its scripts keep working.
 *
 * Spec: https://www.conventionalcommits.org/en/v1.0.0/
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"

export const SPEC_URL = "https://www.conventionalcommits.org/en/v1.0.0/"

/** Types recommended by the spec's Angular-derived guidance (rule 14 allows more). */
export const DEFAULT_TYPES = Object.freeze([
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "style",
  "chore",
  "revert",
])

/** Order used for release notes. */
export const TYPE_ORDER = Object.freeze([
  "feat",
  "fix",
  "perf",
  "revert",
  "refactor",
  "docs",
  "build",
  "ci",
  "test",
  "style",
  "chore",
])

export const TYPE_TITLES = Object.freeze({
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance Improvements",
  revert: "Reverts",
  refactor: "Code Refactoring",
  docs: "Documentation",
  build: "Build System",
  ci: "Continuous Integration",
  test: "Tests",
  style: "Styles",
  chore: "Chores",
  other: "Other Changes",
})

/**
 * Compact guidance injected into an agent's system prompt. Kept short on
 * purpose: it runs on every request, so it earns its tokens by preventing
 * rewrites rather than by restating the whole specification.
 */
export const CONVENTION_BLOCK = `## Commit messages: Conventional Commits 1.0.0 (strict)

Every commit message must follow <${SPEC_URL}>:

    <type>[(scope)][!]: <description>

    [optional body]

    [optional footer(s)]

- type: feat (new capability), fix (bug fix), perf, refactor, docs, test, build, ci, style, chore, revert.
- scope: optional noun naming the area, for example feat(parser): add array support.
- description: imperative mood, no trailing period, one line, at most 100 characters.
- body: one blank line after the description. Explain why, not just what. Wrap near 72 columns.
- footers: one blank line after the body. Token: value, with hyphens in tokens (Reviewed-by: Z, Refs: #123).
- breaking change: add ! before the colon and/or a footer starting with uppercase BREAKING CHANGE:. Describe what broke and how to migrate. It maps to a MAJOR release.
- revert: use the revert type with a Refs: <sha> footer.

The convention is enforced. Write the final message, validate it, then commit. Never bypass enforcement with --no-verify, and never amend or force-push without explicit permission.`

const HEADER_RE = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()\r\n]*)\))?(!)?: (.*)$/
const FOOTER_LINE_RE = /^(BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*)(: | #)(.*)$/
const BREAKING_TOKEN_RE = /^breaking[ -]change$/i

const DEFAULT_IGNORES = [/^Revert "/, /^(fixup|squash|amend)! /]

/**
 * @typedef {{ token: string, separator: string, value: string }} Footer
 * @typedef {{
 *   raw: string,
 *   header: string,
 *   headerValid: boolean,
 *   type: string | null,
 *   typeRaw: string | null,
 *   scope: string | null,
 *   breaking: boolean,
 *   description: string | null,
 *   body: string,
 *   footers: Footer[],
 *   breakingDescription: string | null,
 *   structure: "header-only" | "body" | "footers" | "body+footers" | "missing-blank-line"
 * }} ParsedCommit
 * @typedef {{ rule: number, message: string, fix?: string }} Problem
 */

/**
 * Parse a commit message. Parsing is deliberately forgiving: an invalid
 * message still yields whatever structure could be recovered, so validation
 * can explain precisely what is wrong instead of only saying "invalid".
 *
 * @param {string} input
 * @returns {ParsedCommit}
 */
export function parseCommit(input) {
  const raw = typeof input === "string" ? input : String(input ?? "")
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "")
  const lines = normalized.split("\n")
  while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop()

  const header = lines[0] ?? ""
  /** @type {ParsedCommit} */
  const commit = {
    raw,
    header,
    headerValid: false,
    type: null,
    typeRaw: null,
    scope: null,
    breaking: false,
    description: null,
    body: "",
    footers: [],
    breakingDescription: null,
    structure: "header-only",
  }

  const match = HEADER_RE.exec(header)
  if (match) {
    commit.headerValid = true
    commit.typeRaw = match[1]
    commit.type = match[1].toLowerCase()
    commit.scope = match[2] === undefined ? null : match[2]
    commit.breaking = match[3] === "!"
    commit.description = match[4]
  }

  const rest = lines.slice(1)
  if (rest.length > 0) {
    let bodyLines
    if (rest[0].trim() !== "") {
      // Rule 6: the body must begin one blank line after the description.
      commit.structure = "missing-blank-line"
      bodyLines = rest
    } else {
      bodyLines = rest.slice(1)
    }

    const paragraphs = []
    let current = []
    for (const line of bodyLines) {
      if (line.trim() === "") {
        if (current.length > 0) {
          paragraphs.push(current)
          current = []
        }
      } else {
        current.push(line)
      }
    }
    if (current.length > 0) paragraphs.push(current)

    // Footers are the trailing paragraphs that begin with a valid token.
    // Scanning from the end keeps body paragraphs that merely contain a
    // colon in the middle from being mistaken for trailers.
    let footerStart = paragraphs.length
    while (footerStart > 0 && parseFooterParagraph(paragraphs[footerStart - 1]) !== null) {
      footerStart -= 1
    }

    const footerParagraphs = paragraphs.slice(footerStart)
    const bodyParagraphs = paragraphs.slice(0, footerStart)
    commit.footers = footerParagraphs.flatMap((paragraph) => parseFooterParagraph(paragraph) ?? [])
    commit.body = bodyParagraphs.map((paragraph) => paragraph.join("\n")).join("\n\n")

    if (commit.structure !== "missing-blank-line") {
      if (commit.body && commit.footers.length > 0) commit.structure = "body+footers"
      else if (commit.body) commit.structure = "body"
      else if (commit.footers.length > 0) commit.structure = "footers"
    }
  }

  const breakingFooter = commit.footers.find((footer) => isBreakingFooter(footer))
  if (breakingFooter) commit.breaking = true
  commit.breakingDescription = breakingFooter
    ? breakingFooter.value.trim() || null
    : commit.breaking
      ? (commit.description ?? "").trim() || null
      : null

  return commit
}

/**
 * @param {Footer} footer
 */
function isBreakingFooter(footer) {
  return footer.token === "BREAKING CHANGE" || footer.token === "BREAKING-CHANGE"
}

/**
 * @param {string[]} lines
 * @returns {Footer[] | null}
 */
function parseFooterParagraph(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  if (!FOOTER_LINE_RE.test(lines[0])) return null
  /** @type {Footer[]} */
  const footers = []
  /** @type {Footer | null} */
  let current = null
  for (const line of lines) {
    const match = FOOTER_LINE_RE.exec(line)
    if (match) {
      current = {
        token: match[1],
        separator: match[2],
        value: match[2] === " #" ? `#${match[3]}` : match[3],
      }
      footers.push(current)
    } else if (current) {
      // Rule 10: a footer value may contain newlines.
      current.value += `\n${line}`
    } else {
      return null
    }
  }
  return footers
}

/**
 * @param {string} header
 * @returns {{ kind: string, fix?: string, type?: string, scope?: string, bang?: string, description?: string }}
 */
function diagnoseHeader(header) {
  const value = header.trim()
  if (!value) return { kind: "empty" }

  const bangBeforeScope = /^([A-Za-z][A-Za-z0-9-]*)!\(([^()]*)\)\s*:\s*(.*)$/.exec(value)
  if (bangBeforeScope) {
    const [, type, scope, description] = bangBeforeScope
    return { kind: "bang-placement", type, scope, fix: `${type}(${scope})!: ${description.trim()}` }
  }

  const emptyScope = /^([A-Za-z][A-Za-z0-9-]*)\(\)(!)?\s*:\s*(.*)$/.exec(value)
  if (emptyScope) {
    const [, type, bang = "", description] = emptyScope
    return { kind: "empty-scope", type, fix: `${type}${bang}: ${description.trim()}` }
  }

  const emptyDescription = /^([A-Za-z][A-Za-z0-9-]*)(\([^()]*\))?(!)?\s*:\s*$/.exec(value)
  if (emptyDescription) {
    const [, type, scope = "", bang = ""] = emptyDescription
    return { kind: "empty-description", type, scope, bang }
  }

  const missingSpace = /^([A-Za-z][A-Za-z0-9-]*)(\([^()]*\))?(!)?:(?!\s)(.*)$/.exec(value)
  if (missingSpace) {
    const [, type, scope = "", bang = "", description] = missingSpace
    return { kind: "colon-space", type, scope, bang, fix: `${type}${scope}${bang}: ${description.trim()}` }
  }

  const missingColon = /^([A-Za-z][A-Za-z0-9-]*)(\([^()]*\))?(!)?\s+(.+)$/.exec(value)
  if (missingColon) {
    const [, type, scope = "", bang = "", description] = missingColon
    return { kind: "missing-colon", type, scope, bang, fix: `${type}${scope}${bang}: ${description.trim()}` }
  }

  return { kind: "unknown" }
}

/**
 * @param {Record<string, unknown>} [options]
 */
function normalizeOptions(options = {}) {
  const rawTypes = options.types
  const types =
    rawTypes === null || rawTypes === false
      ? null
      : Array.isArray(rawTypes) && rawTypes.length > 0
        ? rawTypes.map((type) => String(type).toLowerCase())
        : DEFAULT_TYPES

  return {
    types,
    maxHeaderLength: Number.isFinite(options.maxHeaderLength) ? Number(options.maxHeaderLength) : 100,
    enforceHeaderLength: options.enforceHeaderLength === true,
    requireScope: options.requireScope === true,
    allowMergeCommits: options.allowMergeCommits !== false,
    ignore: Array.isArray(options.ignore) ? options.ignore : [],
    readFile: typeof options.readFile === "function" ? options.readFile : null,
  }
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [options]
 */
export function isIgnoredMessage(message, options = {}) {
  const opts = normalizeOptions(options)
  const first = String(message ?? "").trimStart().split("\n")[0] ?? ""
  if (opts.allowMergeCommits && /^Merge\b/.test(first)) return true
  for (const pattern of DEFAULT_IGNORES) {
    if (pattern.test(first)) return true
  }
  for (const pattern of opts.ignore) {
    try {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(String(pattern))
      if (regex.test(first)) return true
    } catch {
      // An invalid user pattern should not make every commit fail.
    }
  }
  return false
}

/**
 * Validate a commit message against Conventional Commits 1.0.0 plus the
 * optional local policy in `options.types` / `options.requireScope`.
 *
 * @param {string} input
 * @param {Record<string, unknown>} [options]
 * @returns {{
 *   valid: boolean,
 *   ignored: boolean,
 *   parsed: ParsedCommit,
 *   violations: Problem[],
 *   warnings: Problem[],
 *   bump: "major" | "minor" | "patch" | null
 * }}
 */
export function validateCommit(input, options = {}) {
  const opts = normalizeOptions(options)
  const parsed = parseCommit(input)
  /** @type {Problem[]} */
  const violations = []
  /** @type {Problem[]} */
  const warnings = []
  /** @type {Set<string>} */
  const seen = new Set()

  /** @param {number} rule @param {string} message @param {string} [fix] */
  const add = (rule, message, fix) => {
    const key = `${rule}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    violations.push(fix ? { rule, message, fix } : { rule, message })
  }
  /** @param {number} rule @param {string} message */
  const warn = (rule, message) => {
    const key = `w${rule}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push({ rule, message })
  }

  if (isIgnoredMessage(parsed.raw, opts)) {
    return { valid: true, ignored: true, parsed, violations, warnings, bump: null }
  }

  const lines = parsed.raw.replace(/\r\n?/g, "\n").split("\n")

  if (!parsed.raw.trim()) {
    add(1, "The commit message is empty.", "Write `<type>: <description>`, for example `fix: handle empty scope`.")
  } else if (!parsed.headerValid) {
    const diagnosis = diagnoseHeader(parsed.header)
    // A guessed correction is only useful when the first word is a type this
    // repository accepts. Otherwise the agent would "fix" `updated stuff` into
    // `updated: stuff`, which is still invalid.
    if (diagnosis.fix && diagnosis.type && opts.types && !opts.types.includes(diagnosis.type.toLowerCase())) {
      delete diagnosis.fix
    }
    const typeHint = `Use one of: ${(opts.types ?? DEFAULT_TYPES).join(", ")}, then ": ", then a short description.`
    if (diagnosis.kind === "empty") {
      add(1, "The first line is blank; a commit must start with its header.", "Put `<type>: <description>` on the first line.")
    } else if (diagnosis.kind === "bang-placement") {
      add(13, "`!` must come immediately before the colon, after the optional scope.", diagnosis.fix)
    } else if (diagnosis.kind === "empty-scope") {
      add(4, "The scope is empty. Remove the parentheses or name the affected area.", diagnosis.fix)
    } else if (diagnosis.kind === "colon-space") {
      add(1, "A single space must follow the colon.", diagnosis.fix ?? typeHint)
    } else if (diagnosis.kind === "missing-colon") {
      add(1, "The header needs a colon and a space between the type/scope and the description.", diagnosis.fix ?? typeHint)
    } else if (diagnosis.kind === "empty-description") {
      add(5, "The description is missing.", "Describe the change in one short line.")
    } else {
      add(
        1,
        'The header does not match `<type>[(scope)][!]: <description>`.',
        diagnosis.fix ?? typeHint,
      )
    }
  }

  if (parsed.headerValid) {
    if (parsed.typeRaw && parsed.typeRaw !== parsed.type) {
      warn(15, `Type "${parsed.typeRaw}" is not lowercase. The spec is case-insensitive; consistent lowercase reads better.`)
    }

    if (opts.types && parsed.type && !opts.types.includes(parsed.type)) {
      add(
        14,
        `Type "${parsed.type}" is not an allowed type here. Allowed: ${opts.types.join(", ")}.`,
        `Use one of the allowed types, or add "${parsed.type}" to the allowed list.`,
      )
    }

    if (parsed.scope !== null) {
      if (parsed.scope.trim() === "") {
        add(4, "The scope is empty. Remove the parentheses or name the affected area.", `Use \`${parsed.type}: <description>\` or \`${parsed.type}(area): <description>\`.`)
      } else if (parsed.scope !== parsed.scope.trim()) {
        add(4, "The scope must not start or end with whitespace.", `Use \`(${parsed.scope.trim()})\`.`)
      } else if (/\s/.test(parsed.scope)) {
        warn(4, "The scope contains whitespace. A scope should be a single noun, such as `parser` or `api`.")
      }
    } else if (opts.requireScope) {
      add(4, "This repository requires a scope.", `Write \`${parsed.type}(area): <description>\`.`)
    }

    if (parsed.description !== null) {
      if (!parsed.description.trim()) {
        add(5, "The description is missing.", "Describe the change in one short line.")
      } else if (parsed.description !== parsed.description.trim()) {
        add(5, "The description must start immediately after the single space that follows the colon.")
      } else if (parsed.description.endsWith(".")) {
        warn(5, "The description ends with a period. Commit subjects normally do not.")
      }
    }

    if (parsed.header.length > opts.maxHeaderLength) {
      const problem = `The header is ${parsed.header.length} characters; keep it at or under ${opts.maxHeaderLength}.`
      if (opts.enforceHeaderLength) add(5, problem, "Shorten the description and move detail into the body.")
      else warn(5, problem)
    }
  }

  if (parsed.structure === "missing-blank-line") {
    add(6, "The body must start one blank line after the description.", "Insert a blank line after the header.")
  }

  for (const footer of parsed.footers) {
    if (!footer.value.trim()) {
      add(footer.token.includes("BREAKING") || footer.token === "BREAKING CHANGE" ? 12 : 8, `Footer "${footer.token}" has no value.`, "Add a value after the separator.")
    }
    if (BREAKING_TOKEN_RE.test(footer.token) && !isBreakingFooter(footer)) {
      add(15, `"${footer.token}" must be written as uppercase BREAKING CHANGE.`, "Use `BREAKING CHANGE: <description>`.")
    }
  }

  // Catch malformed BREAKING CHANGE lines wherever they appear. Doing this on
  // raw lines means a misplaced footer still gets a precise error instead of
  // being silently treated as body prose.
  for (const line of lines) {
    const trimmed = line.trim()
    if (!/^breaking[ -]change\b/i.test(trimmed)) continue
    if (/^BREAKING CHANGE: \S/.test(trimmed) || /^BREAKING-CHANGE: \S/.test(trimmed)) continue
    if (/^breaking[ -]change/i.test(trimmed) && !/^BREAKING[ -]CHANGE/.test(trimmed)) {
      add(15, `"${trimmed.split(":")[0].trim()}" must be uppercase BREAKING CHANGE (or BREAKING-CHANGE).`, "Use `BREAKING CHANGE: <description>`.")
    } else {
      add(12, 'A breaking-change footer must be `BREAKING CHANGE: <description>`.', "Use one colon and one space after the uppercase token.")
    }
  }

  // Footer-looking lines stranded in the body are the most common silent
  // failure: tools never see `Refs: #123` if the blank line is missing.
  for (const paragraph of parsed.body.split("\n\n")) {
    for (const line of paragraph.split("\n")) {
      if (!line.trim()) continue
      if (FOOTER_LINE_RE.test(line)) {
        warn(8, `"${line.split(/[:#]/)[0].trim()}" looks like a footer but is part of the body. Add a blank line before the footer block.`)
      } else if (/^[A-Za-z][A-Za-z0-9-]* [A-Za-z][A-Za-z0-9-]*(: | #)/.test(line)) {
        warn(9, `Footer tokens use hyphens instead of spaces; "${line.split(/[:#]/)[0].trim()}" should use hyphens.`)
      }
    }
  }

  if (parsed.breaking && !parsed.breakingDescription) {
    add(12, "A breaking change needs a description of what broke and how to migrate.", "Add a `BREAKING CHANGE: <migration>` footer.")
  }

  const bump = parsed.breaking
    ? "major"
    : parsed.type === "feat"
      ? "minor"
      : parsed.type
        ? "patch"
        : null

  return { valid: violations.length === 0, ignored: false, parsed, violations, warnings, bump }
}

/**
 * Build a corrected version of a message when the fix is mechanical.
 * Returns null when a human decision is needed (for example, an unknown type).
 *
 * @param {string} input
 * @param {Record<string, unknown>} [options]
 */
export function suggestMessage(input, options = {}) {
  const raw = typeof input === "string" ? input : String(input ?? "")
  if (!raw.trim()) return null
  const lines = raw.replace(/\r\n?/g, "\n").split("\n")
  let header = lines[0].trim()

  if (header) {
    header = header
      .replace(/^([A-Za-z][A-Za-z0-9-]*)!\(([^()]*)\)\s*:\s*(.*)$/, "$1($2)!: $3")
      .replace(/^([A-Za-z][A-Za-z0-9-]*)\(\)(!)?\s*:\s*(.*)$/, "$1$2: $3")

    if (!header.includes(":")) {
      header = header.replace(/^([A-Za-z][A-Za-z0-9-]*(?:\([^()]*\))?!?)\s+(.+)$/, "$1: $2")
    }

    header = header.replace(/^([A-Za-z][A-Za-z0-9-]*(?:\([^()]*\))?!?)\s*:\s*/, "$1: ")

    const typed = /^([A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/.exec(header)
    if (typed) header = typed[1].toLowerCase() + typed[2]

    const described = /^([\s\S]*?:\s*)([\s\S]*)$/.exec(header)
    if (described) header = described[1] + described[2].trim().replace(/\.$/, "")
  }

  const repaired = [header, ...lines.slice(1)].map((line, index) => {
    if (index === 0) return line
    return line.replace(/^(\s*)(breaking[ -]change)\s*:\s*/i, "$1BREAKING CHANGE: ")
  })

  const candidate = repaired.join("\n")
  if (candidate === raw) return null
  const result = validateCommit(candidate, options)
  return result.valid ? candidate : null
}

/**
 * @param {"major" | "minor" | "patch" | null} a
 * @param {"major" | "minor" | "patch" | null} b
 */
function maxBump(a, b) {
  const rank = { major: 3, minor: 2, patch: 1 }
  if (!a) return b
  if (!b) return a
  return rank[a] >= rank[b] ? a : b
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [options]
 */
export function bumpForMessage(message, options = {}) {
  return validateCommit(message, options).bump
}

/**
 * @param {Array<string | { message: string, hash?: string, author?: string, date?: string }>} entries
 * @param {Record<string, unknown>} [options]
 */
export function recommendBump(entries, options = {}) {
  let bump = null
  for (const entry of entries) {
    const message = typeof entry === "string" ? entry : entry.message
    if (isIgnoredMessage(message, options)) continue
    bump = maxBump(bump, validateCommit(message, options).bump)
  }
  return bump
}

/**
 * Build grouped Markdown release notes and the SemVer bump they imply.
 *
 * @param {Array<string | { message: string, hash?: string, author?: string, date?: string }>} entries
 * @param {{ version?: string, date?: string, includeHash?: boolean, types?: string[] | null }} [options]
 */
export function buildChangelog(entries, options = {}) {
  const includeHash = options.includeHash !== false
  const version = options.version ? `[${options.version}]` : "Unreleased"
  const date = options.date ?? new Date().toISOString().slice(0, 10)

  /** @type {Map<string, Array<{ scope: string | null, description: string, hash?: string }>>} */
  const groups = new Map()
  /** @type {Array<{ scope: string | null, description: string, hash?: string }>} */
  const breaking = []
  let bump = null

  const normalized = entries
    .map((entry) => (typeof entry === "string" ? { message: entry } : entry))
    .filter((entry) => entry && typeof entry.message === "string")
    .filter((entry) => !isIgnoredMessage(entry.message, options))

  for (const entry of normalized) {
    const parsed = parseCommit(entry.message)
    const hash = entry.hash ? String(entry.hash).slice(0, 7) : undefined
    if (parsed.type === "feat") bump = maxBump(bump, "minor")
    else if (parsed.type) bump = maxBump(bump, "patch")
    if (parsed.breaking) bump = "major"

    const item = {
      scope: parsed.scope,
      description: (parsed.description ?? parsed.header).trim(),
      hash,
    }
    if (parsed.breaking) {
      breaking.push({
        ...item,
        description: (parsed.breakingDescription ?? parsed.description ?? parsed.header).trim(),
      })
    }

    const type = parsed.type && TYPE_ORDER.includes(parsed.type) ? parsed.type : "other"
    const list = groups.get(type) ?? []
    list.push(item)
    groups.set(type, list)
  }

  /** @param {{ scope: string | null, description: string, hash?: string }} item */
  const renderItem = (item) => {
    const scope = item.scope ? `**${item.scope}:** ` : ""
    const hash = includeHash && item.hash ? ` (${item.hash})` : ""
    return `- ${scope}${item.description}${hash}`
  }

  const sections = [`## ${version}${options.version ? ` - ${date}` : ""}`]

  if (breaking.length > 0) {
    sections.push(["### Breaking Changes", "", ...breaking.map(renderItem)].join("\n"))
  }

  const ordered = [...TYPE_ORDER]
  if (groups.has("other")) ordered.push("other")
  for (const type of ordered) {
    const list = groups.get(type)
    if (!list || list.length === 0) continue
    sections.push([`### ${TYPE_TITLES[type] ?? TYPE_TITLES.other}`, "", ...list.map(renderItem)].join("\n"))
  }

  if (normalized.length === 0) sections.push("_No commits in this range._")

  return {
    markdown: sections.join("\n\n"),
    bump,
    groups: Object.fromEntries(groups),
    breaking,
    commitCount: normalized.length,
  }
}

/**
 * Format a validation result for a terminal or a tool response.
 *
 * @param {ReturnType<typeof validateCommit>} result
 */
export function formatValidation(result) {
  const lines = []
  if (result.ignored) {
    lines.push("OK: message ignored by policy (merge, fixup, or revert commit).")
    return lines.join("\n")
  }
  if (result.valid) {
    lines.push("OK: message conforms to Conventional Commits 1.0.0.")
  } else {
    lines.push(`FAIL: ${result.violations.length} problem${result.violations.length === 1 ? "" : "s"} found.`)
    result.violations.forEach((problem, index) => {
      lines.push(`  ${index + 1}. [rule ${problem.rule}] ${problem.message}`)
      if (problem.fix) lines.push(`     fix: ${problem.fix}`)
    })
  }

  if (!result.valid) {
    // A bare list of problems usually produces another invalid message. Offer
    // the mechanical repair when the intent is unambiguous.
    const suggestion = suggestMessage(result.parsed.raw)
    if (suggestion) lines.push("", "This message would pass:", suggestion)
  }

  const parsed = result.parsed
  const facts = []
  if (parsed.type) facts.push(`type=${parsed.type}`)
  if (parsed.scope) facts.push(`scope=${parsed.scope}`)
  if (parsed.breaking) facts.push("breaking=yes")
  if (result.bump) facts.push(`semver=${result.bump}`)
  if (facts.length > 0) lines.push(`Parsed: ${facts.join(" ")}`)

  if (result.warnings.length > 0) {
    lines.push("Warnings (not violations):")
    for (const warning of result.warnings) lines.push(`  - [rule ${warning.rule}] ${warning.message}`)
  }
  return lines.join("\n")
}

/**
 * @param {string} input
 * @param {number} limit
 */
function truncate(input, limit) {
  const value = String(input ?? "")
  return value.length > limit ? `${value.slice(0, limit)}\n... (${value.length - limit} more characters)` : value
}

/**
 * Turn shell-extraction findings into the message an agent sees when a commit
 * is blocked. It names the violated rule, shows the offending message, and
 * offers a mechanical fix when one exists, because a bare "invalid commit"
 * usually produces another invalid commit.
 *
 * @param {ReturnType<typeof checkShellCommand>} result
 */
export function formatBlockedMessage(result) {
  const lines = ["Commit blocked by conventional-commits (strict mode).", ""]

  for (const finding of result.findings) {
    const invocation = finding.invocation
    lines.push(`Command: ${truncate(invocation.command, 300)}`)

    if (finding.kind === "missing-message") {
      lines.push("No commit message could be found.")
      lines.push('Pass the message inline: git commit -m "fix: explain the bug fix".')
      lines.push("")
      continue
    }
    if (finding.kind === "unverified-file") {
      lines.push(`The message comes from "${invocation.file}", which could not be read for validation.`)
      lines.push('Pass the message inline with -m so it can be checked before the commit exists.')
      lines.push("")
      continue
    }

    lines.push("Message:")
    lines.push(truncate(invocation.message ?? "(unknown)", 800))
    lines.push("")
    lines.push(`Problems (${finding.result.violations.length}):`)
    for (const problem of finding.result.violations) {
      lines.push(`  - [rule ${problem.rule}] ${problem.message}`)
      if (problem.fix) lines.push(`    fix: ${problem.fix}`)
    }

    const suggestion = suggestMessage(invocation.message ?? "", result.options)
    if (suggestion) {
      lines.push("")
      lines.push("This message would pass:")
      lines.push(suggestion)
    }
    lines.push("")
  }

  lines.push("Rewrite the message and run the command again.")
  lines.push(`Specification: ${SPEC_URL}`)
  return lines.join("\n")
}

/* ------------------------------------------------------------------ */
/* Shell command inspection                                            */
/* ------------------------------------------------------------------ */

/**
 * Split a shell command into simple command segments, respecting quotes and
 * treating heredoc bodies as opaque text. Without the heredoc handling, a
 * README that contains an example commit would be blocked as if it were one.
 *
 * @param {string} command
 * @returns {Array<{ segment: string, heredoc: string | null }>}
 */
export function splitShellCommand(command) {
  const source = String(command ?? "").replace(/\r\n?/g, "\n")
  const lines = source.split("\n")
  /** @type {Array<{ segment: string, heredoc: string | null }>} */
  const result = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heredoc = findHeredoc(line)
    let body = null
    if (heredoc) {
      const bodyLines = []
      let next = index + 1
      for (; next < lines.length; next += 1) {
        const candidate = heredoc.stripTabs ? lines[next].replace(/^\t+/, "") : lines[next]
        if (candidate.trimEnd() === heredoc.delimiter || candidate.trim() === heredoc.delimiter) break
        bodyLines.push(lines[next])
      }
      body = bodyLines.join("\n")
      index = next
    }
    for (const segment of splitSegments(line)) {
      if (segment.trim()) result.push({ segment, heredoc: body })
    }
  }
  return result
}

/**
 * @param {string} line
 * @returns {{ delimiter: string, stripTabs: boolean } | null}
 */
function findHeredoc(line) {
  const regex = /<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2/g
  let match
  while ((match = regex.exec(line)) !== null) {
    if (!insideQuotes(line, match.index)) {
      return { delimiter: match[3], stripTabs: match[1] === "-" }
    }
  }
  return null
}

/**
 * @param {string} value
 * @param {number} index
 */
function insideQuotes(value, index) {
  let quote = null
  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = value[cursor]
    if (quote) {
      if (char === "\\" && quote === '"') cursor += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"') {
      quote = char
    }
  }
  return quote !== null
}

/**
 * @param {string} line
 */
function splitSegments(line) {
  /** @type {string[]} */
  const segments = []
  let current = ""
  let quote = null

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      current += char
      if (char === "\\" && quote === '"' && index + 1 < line.length) {
        current += line[index + 1]
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === "\\" && index + 1 < line.length) {
      current += char + line[index + 1]
      index += 1
      continue
    }
    if (char === "\n") continue
    if (char === ";" || char === "|" || char === "&") {
      segments.push(current)
      current = ""
      if ((char === "|" || char === "&") && line[index + 1] === char) index += 1
      continue
    }
    current += char
  }
  segments.push(current)
  return segments
}

/**
 * Quote-aware word splitter for one command segment. It intentionally does
 * not expand variables or command substitutions: a message that depends on
 * runtime expansion cannot be validated before the commit exists.
 *
 * @param {string} value
 */
export function shellWords(value) {
  /** @type {string[]} */
  const words = []
  let current = ""
  let quote = null
  let started = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      started = true
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
      } else if (char === "\\" && index + 1 < value.length && '"\\$`'.includes(value[index + 1])) {
        current += value[index + 1]
        index += 1
      } else {
        current += char
      }
      started = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === "\\" && index + 1 < value.length) {
      current += value[index + 1]
      index += 1
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started || current) {
        words.push(current)
        current = ""
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started || current) words.push(current)
  return words
}

const PREFIX_COMMANDS = new Set(["command", "exec", "sudo", "env", "time", "nohup", "builtin"])
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"])

/**
 * Find every `git commit` invocation in a shell command and recover the
 * message source it will use.
 *
 * @param {string} command
 * @returns {Array<{
 *   command: string,
 *   message: string | null,
 *   file: string | null,
 *   kind: "inline" | "file" | "stdin" | "missing" | "reused",
 *   amend: boolean
 * }>}
 */
export function extractGitCommitInvocations(command) {
  /** @type {ReturnType<typeof extractGitCommitInvocations>} */
  const invocations = []

  for (const { segment, heredoc } of splitShellCommand(command)) {
    const words = shellWords(segment)
    if (words.length === 0) continue

    let cursor = 0
    while (cursor < words.length) {
      const word = words[cursor]
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        cursor += 1
        continue
      }
      if (PREFIX_COMMANDS.has(word)) {
        cursor += 1
        while (cursor < words.length && words[cursor].startsWith("-")) cursor += 1
        continue
      }
      break
    }

    if (words[cursor] !== "git") continue
    cursor += 1

    while (cursor < words.length) {
      const word = words[cursor]
      if (GIT_GLOBAL_WITH_VALUE.has(word)) {
        cursor += 2
        continue
      }
      if (word.startsWith("--git-dir=") || word.startsWith("--work-tree=") || word === "--no-pager" || word === "-p" || word === "--paginate") {
        cursor += 1
        continue
      }
      break
    }

    if (words[cursor] !== "commit") continue
    const args = words.slice(cursor + 1)

    /** @type {string[]} */
    const messages = []
    let file = null
    let noEdit = false
    let reused = false
    let amend = false

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]
      if (arg === "--") break
      if (arg === "-m" || arg === "--message") {
        messages.push(args[index + 1] ?? "")
        index += 1
      } else if (arg.startsWith("--message=")) {
        messages.push(arg.slice("--message=".length))
      } else if (arg === "-F" || arg === "--file") {
        file = args[index + 1] ?? null
        index += 1
      } else if (arg.startsWith("--file=")) {
        file = arg.slice("--file=".length)
      } else if (arg === "--no-edit") {
        noEdit = true
      } else if (arg === "-C" || arg === "-c" || arg === "--reuse-message" || arg === "--reedit-message") {
        reused = true
        index += 1
      } else if (arg.startsWith("--reuse-message=") || arg.startsWith("--reedit-message=")) {
        reused = true
      } else if (arg === "--amend") {
        amend = true
      } else if (arg.startsWith("--fixup") || arg.startsWith("--squash")) {
        reused = true
      } else if (arg.startsWith("--")) {
        // Long flag, possibly with a value in the next argument.
        if (["--author", "--date", "--template", "--cleanup", "--trailer", "--pathspec-from-file"].includes(arg)) index += 1
      } else if (arg.startsWith("-") && arg.length > 1) {
        for (let letter = 1; letter < arg.length; letter += 1) {
          const flag = arg[letter]
          if (flag === "m" || flag === "F") {
            const attached = arg.slice(letter + 1)
            if (attached) {
              if (flag === "m") messages.push(attached)
              else file = attached
            } else {
              const next = args[index + 1] ?? ""
              if (flag === "m") messages.push(next)
              else file = next
              index += 1
            }
            break
          }
          if (flag === "C" || flag === "c") {
            reused = true
            if (!arg.slice(letter + 1)) index += 1
            break
          }
        }
      }
    }

    let message = null
    let kind = "missing"
    if (messages.length > 0) {
      message = messages.join("\n\n")
      kind = "inline"
    } else if (file && file !== "-") {
      kind = "file"
    } else if (file === "-") {
      if (heredoc !== null) {
        message = heredoc
        kind = "inline"
      } else {
        kind = "stdin"
      }
    } else if (noEdit || reused) {
      kind = "reused"
    }

    invocations.push({ command: segment.trim(), message, file, kind, amend })
  }

  return invocations
}

/**
 * Validate every `git commit` in a shell command.
 *
 * @param {string} command
 * @param {Record<string, unknown> & { readFile?: (path: string) => string | null }} [options]
 */
export function checkShellCommand(command, options = {}) {
  const invocations = extractGitCommitInvocations(command)
  /** @type {Array<{ kind: string, invocation: any, result?: ReturnType<typeof validateCommit> }>} */
  const findings = []

  for (const invocation of invocations) {
    if (invocation.kind === "reused") continue

    let message = invocation.message
    if (message === null && invocation.kind === "file" && invocation.file) {
      try {
        const reader = options.readFile ?? ((path) => readFileSync(resolve(process.cwd(), path), "utf8"))
        message = reader(invocation.file)
      } catch {
        message = null
      }
      if (message === null) {
        findings.push({ kind: "unverified-file", invocation })
        continue
      }
    }

    if (message === null) {
      findings.push({ kind: "missing-message", invocation })
      continue
    }

    if (isIgnoredMessage(message, options)) continue
    const result = validateCommit(message, options)
    if (!result.valid) findings.push({ kind: "invalid", invocation: { ...invocation, message }, result })
  }

  return { blocked: findings.length > 0, findings, invocations, options }
}

/* ------------------------------------------------------------------ */
/* Git helpers used by the CLI                                         */
/* ------------------------------------------------------------------ */

/**
 * Read commits from a git range. `from` may be empty to include the whole
 * history. Returns newest-first entries.
 *
 * @param {{ from?: string, to?: string, cwd?: string }} [input]
 */
export function readGitCommits(input = {}) {
  const cwd = input.cwd ?? process.cwd()
  const to = input.to || "HEAD"
  const range = input.from ? `${input.from}..${to}` : to
  const format = "%H%x1f%an%x1f%aI%x1f%B%x1e"
  let output
  try {
    output = execFileSync("git", ["log", `--format=${format}`, range], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    return []
  }

  return output
    .split("\x1e")
    .map((record) => record.trimStart())
    .filter(Boolean)
    .map((record) => {
      const [hash, author, date, ...rest] = record.split("\x1f")
      return { hash, author, date, message: rest.join("\x1f").replace(/\n+$/, "") }
    })
}

/**
 * @param {string} [cwd]
 * @returns {string | null}
 */
export function latestTag(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() || null
  } catch {
    return null
  }
}

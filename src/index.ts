/**
 * conventional-commits — an OpenCode V2 plugin that enforces Conventional
 * Commits 1.0.0.
 *
 * Four things are registered:
 *
 *   1. a system-prompt block that states the convention on every request
 *   2. `validate_commit`, a tool the agent must call before committing
 *   3. `/commit`, a command that writes the message for the staged changes
 *   4. `commit_changelog`, which groups commits and recommends a SemVer bump
 *
 * Strict enforcement is a `tool.execute.before` hook: a `git commit` shell
 * command with a non-conforming message never runs. Everything else is
 * guidance, so a blocked commit comes with the exact problem and a fix.
 *
 * The parser, validator, changelog builder, and shell inspector live in
 * `skills/conventional-commits/scripts/conventional-commits.mjs` so the skill,
 * the CLI, the Claude Code hook, and this plugin share one implementation.
 */

import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Plugin, Skill } from "@opencode/plugin"

import {
  CONVENTION_BLOCK,
  SPEC_URL,
  buildChangelog,
  checkShellCommand,
  formatBlockedMessage,
  formatValidation,
  latestTag,
  readGitCommits,
  validateCommit,
  type ValidateOptions,
} from "../skills/conventional-commits/scripts/conventional-commits.mjs"

const PLUGIN_ID = "conventional-commits"
const SKILL_ID = "conventional-commits"
const SKILL_NAME = "Conventional Commits"
const SKILL_DESCRIPTION =
  "Write, validate, and release Conventional Commits 1.0.0. Use when composing a commit message, reviewing commit history, generating a changelog, or deciding a SemVer bump."
const PROMPT_MARKER = "Conventional Commits 1.0.0 (strict)"

/** Tools whose input is a shell command. Providers name this differently. */
const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "run_shell_command",
  "exec_command",
  "local_shell",
  "container.exec",
  "container_exec",
])

const COMMIT_COMMAND = `Create a Conventional Commits 1.0.0 commit for the staged changes.

1. Inspect what is staged: run \`git diff --cached --stat\` and \`git diff --cached\`.
   If nothing is staged, stop and say so instead of staging files yourself.
2. Pick the type that describes the change from a user's point of view:
   feat, fix, perf, refactor, docs, test, build, ci, style, chore, revert.
   Add a scope naming the affected area when it is not obvious.
3. Write the message:

       <type>[(scope)][!]: <description>

       [optional body]

       [optional footer(s)]

   - description: imperative mood, no trailing period, at most 100 characters
   - body: one blank line after the description; explain why, not what
   - footers: one blank line after the body, \`Token: value\` with hyphenated tokens
   - breaking: \`!\` before the colon and a \`BREAKING CHANGE: <migration>\` footer
4. Call \`validate_commit\` with the exact final message and fix every reported
   problem. Do not commit until it reports OK.
5. Commit with one \`-m\` per section, for example:

       git commit -m "feat(api): add cursor pagination" -m "Clients can now page large result sets." -m "Refs: #482"

   Never use \`--no-verify\`, never amend, and never push unless asked.
6. Report the new commit hash and the message you used.`

type NormalizedOptions = ValidateOptions & {
  strict: boolean
  systemPrompt: boolean
  registerSkill: boolean
  registerCommand: boolean
}

function normalizeOptions(raw: Readonly<Record<string, unknown>>): NormalizedOptions {
  const types = Array.isArray(raw.types)
    ? raw.types.map((type) => String(type))
    : raw.types === null || raw.types === false
      ? null
      : undefined

  const validate: ValidateOptions = {}
  if (types !== undefined) validate.types = types
  if (typeof raw.maxHeaderLength === "number" && Number.isFinite(raw.maxHeaderLength)) {
    validate.maxHeaderLength = raw.maxHeaderLength
  }
  if (raw.enforceHeaderLength === true) validate.enforceHeaderLength = true
  if (raw.requireScope === true) validate.requireScope = true
  if (raw.allowMergeCommits === false) validate.allowMergeCommits = false
  if (Array.isArray(raw.ignore)) validate.ignore = raw.ignore.map(String)

  return {
    ...validate,
    strict: raw.strict !== false,
    systemPrompt: raw.systemPrompt !== false,
    registerSkill: raw.registerSkill !== false,
    registerCommand: raw.command !== false,
  }
}

/**
 * The validator tool reports the parsed facts and the SemVer impact as
 * metadata so a client can present the result without reading the prose.
 */
function validateCommitTool(options: NormalizedOptions) {
  return {
    name: "validate_commit",
    description:
      "Validate a complete commit message against Conventional Commits 1.0.0. Returns each violated rule with a fix, plus the SemVer bump the message implies. Call this with the exact final message before running `git commit`.",
    input: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The complete commit message, including the header, body, and footers.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
    execute: async (input: unknown) => {
      const message = readString(input, "message")
      const result = validateCommit(message, options)
      return {
        content: formatValidation(result),
        metadata: {
          valid: result.valid,
          ignored: result.ignored,
          type: result.parsed.type,
          scope: result.parsed.scope,
          breaking: result.parsed.breaking,
          bump: result.bump,
          violations: result.violations.length,
          warnings: result.warnings.length,
        },
      }
    },
  }
}

function changelogTool(cwd: string) {
  return {
    name: "commit_changelog",
    description:
      "Group commits in a git range by type, render Markdown release notes, and recommend a Semantic Versioning bump. Defaults to the commits since the latest tag.",
    input: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start of the range. Defaults to the latest tag." },
        to: { type: "string", description: "End of the range. Defaults to HEAD." },
        version: { type: "string", description: "Version heading for the release, for example 1.4.0." },
        date: { type: "string", description: "Release date in YYYY-MM-DD form. Defaults to today." },
      },
      additionalProperties: false,
    },
    execute: async (input: unknown) => {
      const from = readString(input, "from") || latestTag(cwd) || undefined
      const to = readString(input, "to") || "HEAD"
      const version = readString(input, "version") || undefined
      const date = readString(input, "date") || undefined

      const commits = readGitCommits({ from, to, cwd })
      const result = buildChangelog(commits, { version, date })

      const count = `${result.commitCount} commit${result.commitCount === 1 ? "" : "s"}`
      const header = `Range: ${from ?? "the first commit"}..${to} (${count})`
      const bump = `Recommended bump: ${result.bump ?? "none"}`
      return {
        content: `${header}\n${bump}\n\n${result.markdown}`,
        metadata: { bump: result.bump, commits: result.commitCount, from: from ?? null, to },
      }
    },
  }
}

function readString(input: unknown, key: string): string {
  if (!input || typeof input !== "object") return ""
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

/**
 * Recover the shell command from a tool call. Providers disagree on whether
 * the field is `command` (string), `command` (argv array), or `cmd`.
 */
function readCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  if (typeof record.command === "string") return record.command
  if (Array.isArray(record.command)) return record.command.map(String).join(" ")
  if (typeof record.cmd === "string") return record.cmd
  return null
}

/**
 * Split YAML frontmatter from a skill file. Only `description` is needed, so a
 * full YAML parser would be overkill.
 */
function parseSkillFile(source: string): { description: string | null; content: string } {
  const normalized = source.replace(/\r\n?/g, "\n")
  if (!normalized.startsWith("---\n")) return { description: null, content: normalized }
  const end = normalized.indexOf("\n---", 4)
  if (end === -1) return { description: null, content: normalized }
  const frontmatter = normalized.slice(4, end)
  const content = normalized.slice(end + 4).replace(/^\n+/, "")
  const match = /^description:\s*(.+)$/m.exec(frontmatter)
  const description = match ? match[1].trim().replace(/^["']|["']$/g, "") : null
  return { description: description || null, content }
}

async function loadSkill(): Promise<{ file: string; description: string | null; content: string } | null> {
  const file = fileURLToPath(new URL("../skills/conventional-commits/SKILL.md", import.meta.url))
  try {
    const parsed = parseSkillFile(await readFile(file, "utf8"))
    return { file, ...parsed }
  } catch {
    // A missing SKILL.md should not stop the plugin from validating commits.
    return null
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const options = normalizeOptions(ctx.options)
    const cwd = ctx.location.directory

    if (options.systemPrompt) {
      await ctx.session.hook("context", (event) => {
        const present = event.system.some(
          (part) => typeof part.text === "string" && part.text.includes(PROMPT_MARKER),
        )
        if (present) return
        event.system.push({ type: "text", text: CONVENTION_BLOCK })
      })
    }

    await ctx.tool.transform((editor) => {
      editor.add(validateCommitTool(options))
      editor.add(changelogTool(cwd))
    })

    if (options.registerCommand) {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "commit",
          description: "Write and validate a Conventional Commit for the staged changes",
          execute: async ({ sessionID, prompt, delivery }) => {
            const extra = prompt.text.trim()
            const text = extra ? `${COMMIT_COMMAND}\n\n## Additional instruction\n\n${extra}` : COMMIT_COMMAND
            await ctx.session.prompt({ ...prompt, sessionID, text, delivery })
          },
        })
      })
    }

    if (options.registerSkill) {
      // Read before registering: transforms are synchronous and must not touch
      // the filesystem.
      const skill = await loadSkill()
      if (skill) {
        const { data } = await ctx.skill.list()
        if (!data.some((entry) => entry.id === SKILL_ID)) {
          await ctx.skill.transform((editor) => {
            editor.add({
              id: Skill.ID.make(SKILL_ID),
              name: Skill.Name.make(SKILL_NAME),
              description: skill.description ?? SKILL_DESCRIPTION,
              path: Skill.Info.fields.path.make(skill.file),
              content: skill.content,
            })
          })
        }
      }
    }

    if (options.strict) {
      await ctx.tool.hook("execute.before", (event) => {
        if (!SHELL_TOOLS.has(event.tool)) return
        const command = readCommand(event.input)
        // Cheap rejection first: most tool calls never mention git.
        if (!command || !command.includes("git")) return

        const result = checkShellCommand(command, {
          ...options,
          readFile: (path) => {
            try {
              return readFileSync(resolve(cwd, path), "utf8")
            } catch {
              return null
            }
          },
        })
        // Rejecting fails only this tool call; the agent sees the reason and
        // can rewrite the message.
        if (result.blocked) throw new Error(formatBlockedMessage(result))
      })
    }
  },
})

export { COMMIT_COMMAND, PLUGIN_ID, SKILL_DESCRIPTION, SKILL_ID, SPEC_URL }

#!/usr/bin/env node
/**
 * Portable CLI for the conventional-commits skill.
 *
 * It only depends on Node built-ins and its sibling engine, so the skill can be
 * copied into any agent's skills directory and still work.
 *
 *   node cli.mjs validate --message "feat: add parser"
 *   node cli.mjs validate --file .git/COMMIT_EDITMSG
 *   node cli.mjs changelog --from v1.2.0 --to HEAD --version 1.3.0
 *   node cli.mjs bump --from v1.2.0
 *   node cli.mjs check-command --command "git commit -m 'bad message'"
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_TYPES,
  SPEC_URL,
  buildChangelog,
  checkShellCommand,
  formatBlockedMessage,
  formatValidation,
  latestTag,
  readGitCommits,
  recommendBump,
  suggestMessage,
  validateCommit,
} from "./conventional-commits.mjs"
import { main as installHook } from "./install.mjs"

const USAGE = `conventional-commits — validate and release Conventional Commits

Usage:
  conventional-commits validate [options] [message]
      -m, --message <text>   Validate this message
      -F, --file <path>      Validate the contents of a file (for example .git/COMMIT_EDITMSG)
          --stdin            Read the message from standard input (the default when piped)
          --types <list>     Comma-separated allowed types (default: ${DEFAULT_TYPES.join(",")})
          --any-type         Accept any type, as the specification permits
          --json             Print the full result as JSON

  conventional-commits changelog [options]
          --from <ref>       Start of the range (default: the latest tag)
          --to <ref>         End of the range (default: HEAD)
          --version <value>  Version heading, for example 1.3.0
          --date <value>     Release date (default: today)
          --no-hash          Omit short hashes
          --types <list>     Comma-separated allowed types
          --any-type         Accept any type
          --json             Print the result as JSON

  conventional-commits bump [--from <ref>] [--to <ref>]
      Print major, minor, patch, or none for the range.

  conventional-commits check-command [--command <shell>] [--stdin] [--claude]
      Validate every git commit inside a shell command. Reads Claude Code hook JSON
      from stdin, or pass --command directly. --claude exits 2 when blocked.

  conventional-commits suggest -m <text>
      Print a mechanically repaired message, if one is possible.

  conventional-commits install-hooks [--dir <repository>] [--force]
      Install a git commit-msg hook that validates every commit in the repository.

  conventional-commits uninstall-hooks [--dir <repository>] [--force]
      Remove a hook installed by this tool.

Specification: ${SPEC_URL}
`

/**
 * @param {string[]} [argv]
 * @returns {Promise<number>} exit code
 */
export async function run(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv
  switch (command) {
    case "validate":
      return validateCommand(rest)
    case "changelog":
      return changelogCommand(rest)
    case "bump":
      return bumpCommand(rest)
    case "check-command":
      return checkCommandCommand(rest)
    case "suggest":
      return suggestCommand(rest)
    case "install-hooks":
      return installHook(rest)
    case "uninstall-hooks":
      return installHook([...rest, "--uninstall"])
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE)
      return 0
    case undefined:
      process.stdout.write(USAGE)
      return 0
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`)
      return 2
  }
}

/**
 * @param {string[]} args
 * @param {string[]} names
 */
function unknownFlag(args, names) {
  return args.find((arg) => arg.startsWith("-") && !names.includes(arg) && !arg.includes("="))
}

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
 * @param {string[]} args
 */
function takeTypes(args, fallback = DEFAULT_TYPES) {
  let types = fallback
  let anyType = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--types") {
      types = String(args[index + 1] ?? "").split(",").map((type) => type.trim()).filter(Boolean)
      index += 1
    } else if (arg.startsWith("--types=")) {
      types = arg.slice("--types=".length).split(",").map((type) => type.trim()).filter(Boolean)
    } else if (arg === "--any-type" || arg === "--no-types") {
      anyType = true
    }
  }
  return anyType ? null : types
}

/**
 * @param {string} path
 */
function readMessageFile(path) {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8")
  } catch (error) {
    process.stderr.write(`Could not read "${path}": ${error instanceof Error ? error.message : String(error)}\n`)
    return null
  }
}

/**
 * @param {string[]} args
 */
async function validateCommand(args) {
  let message = null
  let file = null
  let json = false
  let provided = false
  const positional = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--json") json = true
    else if (arg === "--stdin") message = null
    else if (arg === "-m" || arg === "--message") {
      message = args[index + 1] ?? ""
      provided = true
      index += 1
    } else if (arg.startsWith("--message=")) {
      message = arg.slice("--message=".length)
      provided = true
    } else if (arg === "-F" || arg === "--file") {
      file = args[index + 1] ?? ""
      provided = true
      index += 1
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length)
      provided = true
    } else if (arg === "--types" || arg.startsWith("--types=") || arg === "--any-type" || arg === "--no-types") {
      index += arg === "--types" ? 1 : 0
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE)
      return 0
    } else if (arg.startsWith("-") && !/^-\d/.test(arg)) {
      process.stderr.write(`Unknown option "${arg}".\n`)
      return 2
    } else {
      positional.push(arg)
    }
  }

  if (file !== null) {
    message = readMessageFile(file)
    if (message === null) return 2
  } else if (!provided) {
    if (positional.length > 0) {
      message = positional.join(" ")
    } else {
      const stdin = await readStdin()
      if (stdin === "") {
        process.stderr.write('No message supplied. Pass it after the command, with -m, with -F, or through stdin.\n')
        return 2
      }
      message = stdin
    }
  }

  const types = takeTypes(args)
  const result = validateCommit(message, { types })

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`${formatValidation(result)}\n`)
  }
  return result.valid ? 0 : 1
}

/**
 * @param {string[]} args
 */
async function suggestCommand(args) {
  let message = null
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-m" || args[index] === "--message") message = args[index + 1] ?? ""
    else if (args[index].startsWith("--message=")) message = args[index].slice("--message=".length)
  }
  if (message === null) message = await readStdin()
  if (!message) {
    process.stderr.write("No message supplied.\n")
    return 2
  }
  const suggestion = suggestMessage(message, { types: takeTypes(args) })
  if (!suggestion) {
    process.stdout.write("No mechanical fix is possible; the type or content needs a human decision.\n")
    return 1
  }
  process.stdout.write(`${suggestion}\n`)
  return 0
}

/**
 * @param {string[]} args
 */
function rangeOptions(args) {
  let from = null
  let to = "HEAD"
  let version
  let date
  let includeHash = true
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--from") from = args[++index] ?? null
    else if (arg.startsWith("--from=")) from = arg.slice("--from=".length)
    else if (arg === "--to") to = args[++index] ?? "HEAD"
    else if (arg.startsWith("--to=")) to = arg.slice("--to=".length)
    else if (arg === "--version") version = args[++index]
    else if (arg.startsWith("--version=")) version = arg.slice("--version=".length)
    else if (arg === "--date") date = args[++index]
    else if (arg.startsWith("--date=")) date = arg.slice("--date=".length)
    else if (arg === "--no-hash") includeHash = false
    else if (arg === "--json") json = true
    else if (arg === "--types" || arg.startsWith("--types=")) index += arg === "--types" ? 1 : 0
  }

  return { from, to, version, date, includeHash, json, types: takeTypes(args) }
}

/**
 * @param {string[]} args
 */
function changelogCommand(args) {
  const options = rangeOptions(args)
  const from = options.from ?? latestTag()
  const commits = readGitCommits({ from: from ?? undefined, to: options.to })
  const result = buildChangelog(commits, {
    version: options.version,
    date: options.date,
    includeHash: options.includeHash,
    types: options.types,
  })

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...result, from: from ?? null, to: options.to }, null, 2)}\n`)
  } else {
    process.stdout.write(`${result.markdown}\n`)
  }
  return 0
}

/**
 * @param {string[]} args
 */
function bumpCommand(args) {
  const options = rangeOptions(args)
  const from = options.from ?? latestTag()
  const commits = readGitCommits({ from: from ?? undefined, to: options.to })
  const bump = recommendBump(commits, { types: options.types })
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ bump, from: from ?? null, to: options.to, commits: commits.length }, null, 2)}\n`)
  } else {
    process.stdout.write(`${bump ?? "none"}\n`)
  }
  return 0
}

/**
 * @param {string[]} args
 */
async function checkCommandCommand(args) {
  let command = null
  let claude = false
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--command" || arg === "-c") command = args[++index] ?? ""
    else if (arg.startsWith("--command=")) command = arg.slice("--command=".length)
    else if (arg === "--claude") claude = true
    else if (arg === "--json") json = true
    else if (arg === "--stdin") command = null
    else if (arg === "--types" || arg.startsWith("--types=") || arg === "--any-type" || arg === "--no-types") {
      index += arg === "--types" ? 1 : 0
    }
  }

  if (command === null) {
    const stdin = await readStdin()
    if (!stdin.trim()) {
      process.stderr.write("No command supplied. Use --command or pipe hook JSON on stdin.\n")
      return 2
    }
    try {
      const payload = JSON.parse(stdin)
      command = payload?.tool_input?.command ?? payload?.command ?? null
    } catch {
      command = stdin
    }
  }

  if (!command) {
    process.stderr.write("No shell command found in the input.\n")
    return 2
  }

  const result = checkShellCommand(command, {
    types: takeTypes(args),
    readFile: (path) => {
      try {
        return readFileSync(resolve(process.cwd(), path), "utf8")
      } catch {
        return null
      }
    },
  })

  if (json) {
    process.stdout.write(`${JSON.stringify({ blocked: result.blocked, findings: result.findings, invocations: result.invocations }, null, 2)}\n`)
  } else if (result.blocked) {
    process.stderr.write(`${formatBlockedMessage(result)}\n`)
  } else {
    process.stdout.write("OK: no commit message violations.\n")
  }

  if (!result.blocked) return 0
  return claude ? 2 : 1
}

const invokedDirectly =
  typeof process.argv[1] === "string" && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  run().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}

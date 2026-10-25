#!/usr/bin/env node
/**
 * Install the `commit-msg` git hook for the current repository.
 *
 *     node scripts/install.mjs
 *     node scripts/install.mjs --dir /path/to/repo
 *     node scripts/install.mjs --uninstall
 *     node scripts/install.mjs --force     # replace a foreign commit-msg hook
 *
 * The hook is a two-line shell script that runs `git-commit-msg.mjs` with the
 * absolute path of this checkout, so the repository keeps working no matter
 * which directory git is invoked from.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const MARKER = "conventional-commits-skill"
const SCRIPT = fileURLToPath(new URL("./git-commit-msg.mjs", import.meta.url))

const USAGE = `Install a Conventional Commits commit-msg hook.

Usage:
  install.mjs [--dir <repository>] [--uninstall] [--force]

Options:
  --dir <path>   Install into this repository instead of the current one.
  --uninstall    Remove a hook installed by this tool.
  --force        Replace an existing commit-msg hook, or remove a foreign one.
  -h, --help     Show this message.
`

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/**
 * Resolve the hooks directory from git, so `core.hooksPath` is respected.
 * `git rev-parse --git-path` prints a path relative to the working directory.
 *
 * @param {string} cwd
 */
function hooksDirectory(cwd) {
  return resolve(cwd, git(["rev-parse", "--git-path", "hooks"], cwd))
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let directory = null
  let uninstall = false
  let force = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dir") directory = argv[++index] ?? null
    else if (arg.startsWith("--dir=")) directory = arg.slice("--dir=".length)
    else if (arg === "--uninstall") uninstall = true
    else if (arg === "--force") force = true
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE)
      return 0
    } else {
      process.stderr.write(`Unknown option "${arg}".\n\n${USAGE}`)
      return 2
    }
  }

  const cwd = directory ? resolve(directory) : process.cwd()

  let hooks
  try {
    hooks = hooksDirectory(cwd)
  } catch {
    process.stderr.write(
      cwd === process.cwd()
        ? "Not inside a git repository. Run this from a repository, or pass --dir <repository>.\n"
        : `"${cwd}" is not a git repository.\n`,
    )
    return 1
  }

  const hookPath = resolve(hooks, "commit-msg")
  const existing = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : null
  const ours = existing !== null && existing.includes(MARKER)

  if (uninstall) {
    if (existing === null) {
      process.stdout.write(`No commit-msg hook at ${hookPath}; nothing to remove.\n`)
      return 0
    }
    if (!ours && !force) {
      process.stderr.write(
        `${hookPath} was not installed by this tool. Re-run with --force to remove it anyway.\n`,
      )
      return 1
    }
    rmSync(hookPath, { force: true })
    process.stdout.write(`Removed ${hookPath}.\n`)
    return 0
  }

  if (existing !== null && !ours && !force) {
    process.stderr.write(
      `${hookPath} already exists and was not installed by this tool. Re-run with --force to replace it.\n`,
    )
    return 1
  }

  // Git for Windows runs hooks through sh, which is happiest with forward
  // slashes and an absolute interpreter path.
  const node = process.execPath.replace(/\\/g, "/")
  const script = SCRIPT.replace(/\\/g, "/")
  const content = [
    "#!/bin/sh",
    `# ${MARKER}: validate the commit message before git accepts it.`,
    "# Remove this file, or run: npx conventional-commits-skill uninstall-hooks",
    `exec "${node}" "${script}" "$1"`,
    "",
  ].join("\n")

  mkdirSync(hooks, { recursive: true })
  writeFileSync(hookPath, content, "utf8")
  try {
    chmodSync(hookPath, 0o755)
  } catch {
    // Windows has no execute bit; git finds the shebang anyway.
  }

  process.stdout.write(`Installed ${hookPath}.\n`)
  process.stdout.write("Commits in this repository are now validated against Conventional Commits 1.0.0.\n")
  return 0
}

const invokedDirectly =
  typeof process.argv[1] === "string" && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}

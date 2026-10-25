# Agent instructions

## Commits are enforced

This repository follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Compose every commit message as:

```
<type>[(scope)][!]: <description>

[optional body]

[optional footer(s)]
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`.

- Use the imperative mood: "add", not "added" or "adds".
- No trailing period in the description; keep the header at or under 100 characters.
- Put one blank line after the description and one before the footer block.
- Mark breaking changes with `!` before the colon **and** a `BREAKING CHANGE: <migration>` footer.
- One intent per commit. Do not stage unrelated files to make a commit "complete".

Validate before committing:

```bash
node skills/conventional-commits/scripts/cli.mjs validate -m "<the exact final message>"
```

A non-conforming message is rejected by the plugin hook and by the git `commit-msg` hook. There is no bypass: never add `--no-verify`, never amend, and never force-push without an explicit request.

## Repository rules

- The engine in `skills/conventional-commits/scripts/conventional-commits.mjs` has **no dependencies** and no build step, and is shared by the plugin, the CLI, and both hooks. Keep it that way.
- The skill directory must stay portable: it is copied verbatim into other agents' skill folders. Never import from `src/` or `node_modules` inside it.
- `src/index.ts` is the only TypeScript file that ships. Keep the public JSON schemas and descriptions stable; agents depend on the wording.
- Default types and the allowed-type policy live in the engine, not in the plugin. Change them once, in `DEFAULT_TYPES`.
- Warnings are style; violations block. Do not promote a preference to a violation without an option that restores the old behaviour.

## Before you finish

```bash
npm test          # engine, CLI, hooks, plugin
npm run typecheck # tsc --noEmit
claude plugin validate .   # manifests and hooks, if Claude Code is installed
```

Add a test for every behaviour change. The suites that matter: `tests/engine.test.mjs` (rules and shell parsing), `tests/cli.test.mjs` (exit codes and git ranges), `tests/hooks.test.mjs` (both hooks and the installer), `tests/plugin.test.mjs` (registrations and the blocking hook).

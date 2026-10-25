# conventional-commits-skill

Strict [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) enforcement for AI coding agents, plus the release helpers the convention is for.

One dependency-free engine drives four entry points:

| Feature | What it does |
| --- | --- |
| **System prompt block** | States the convention on every model request, so the agent writes a valid message the first time. |
| **`validate_commit` tool** | Parses a message, names each violated rule, offers a mechanical fix, and reports the SemVer bump. |
| **`/commit` command** | Reviews the staged diff, writes the message, validates it, and commits. |
| **Changelog + SemVer** | Groups commits by type into Markdown release notes and recommends `major`, `minor`, `patch`, or `none`. |

Enforcement is **always strict**: a `git commit` with a non-conforming message is blocked, not merely discouraged. The agent receives the exact rule, the offending message, and a corrected version.

Works with **OpenCode** (V2 plugin), **Claude Code** (plugin), **Codex** (skill), any other agent that reads `SKILL.md`, and plain terminals through a CLI and a git hook.

## Install

### OpenCode

Add the plugin to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./conventional-commits-skill"]
}
```

Or, once published to npm:

```jsonc
{
  "plugins": ["conventional-commits-skill"]
}
```

The plugin registers the skill, the tools, `/commit`, the prompt block, and the blocking shell hook. No other setup is needed.

### Claude Code

From a checkout:

```bash
claude --plugin-dir /path/to/conventional-commits-skill
```

From GitHub as a marketplace:

```bash
/plugin marketplace add theshoqanebi/conventional-commits-skill
/plugin install conventional-commits@conventional-commits
```

The plugin ships a `PreToolUse` hook that exits `2` when a `Bash` call contains a non-conforming `git commit`, which blocks the call and shows the reason to the model.

### Codex

Codex discovers skills in `.agents/skills` (project) and `~/.agents/skills` (user):

```bash
mkdir -p .agents/skills
cp -r skills/conventional-commits .agents/skills/
```

Skills inform the model but cannot block a tool call, so install the git hook for enforcement:

```bash
node .agents/skills/conventional-commits/scripts/install.mjs
```

### Any repository, any editor

The git hook validates the message git is about to record, so it covers IDE commit panels, `git commit` without `-m`, and agents without hooks:

```bash
npx conventional-commits-skill install-hooks
# or, from a checkout:
node skills/conventional-commits/scripts/install.mjs
```

Remove it with `npx conventional-commits-skill uninstall-hooks`. The installer respects `core.hooksPath` and refuses to overwrite a hook it did not create unless you pass `--force`.

## Use

### In an agent

Ask for a commit; the agent validates and commits. In OpenCode, `/commit` does the whole flow:

```
/commit scope api, mention the cursor pagination
```

The agent runs `git diff --cached`, writes the message, calls `validate_commit`, and only then commits. If it tries to skip a step, the shell hook blocks the command.

### In a terminal

```bash
# Validate
npx conventional-commits-skill validate -m "feat(api): add cursor pagination"
npx conventional-commits-skill validate -F .git/COMMIT_EDITMSG
echo "fix: handle empty scope" | npx conventional-commits-skill validate --stdin

# Repair a message that is mechanically fixable
npx conventional-commits-skill suggest -m "feat add parser"
# feat: add parser

# Inspect the command an agent is about to run
npx conventional-commits-skill check-command -c 'git commit -m "nope"'

# Release helpers
npx conventional-commits-skill bump --from v1.2.0
# minor
npx conventional-commits-skill changelog --from v1.2.0 --version 1.3.0
```

Exit codes: `0` valid, `1` invalid, `2` usage error. `check-command --claude` uses `2` for invalid so it can serve as a Claude Code hook.

## What "strict" means

Blocked, because the specification requires it:

- a missing type, a missing colon, or no space after the colon
- an empty scope or an empty description
- a body that does not start after exactly one blank line
- a footer without a value, or a footer token using spaces instead of hyphens
- a lowercase or mixed-case `BREAKING CHANGE`
- a type outside the allowed list (rule 14 permits others; this project's default list does not)

Warnings, because the specification is silent or explicitly case-insensitive:

- an uppercase type, a scope containing spaces, a trailing period
- a header longer than 100 characters (promote to a violation with `enforceHeaderLength`)

Ignored, because other tools generate them:

- `Merge ...`, `fixup! ...`, `squash! ...`, and `Revert "..."`

## Configuration

OpenCode reads options from the plugin entry:

```jsonc
{
  "plugins": [
    {
      "package": "./conventional-commits-skill",
      "options": {
        "types": ["feat", "fix", "perf", "docs", "chore"],
        "requireScope": true,
        "maxHeaderLength": 72
      }
    }
  ]
}
```

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | Block non-conforming `git commit` tool calls. |
| `types` | the eleven below | Allowed types. `null` accepts any type, as rule 14 permits. |
| `requireScope` | `false` | Require a scope on every commit. |
| `maxHeaderLength` | `100` | Length that triggers the header warning. |
| `enforceHeaderLength` | `false` | Turn that warning into a violation. |
| `allowMergeCommits` | `true` | Skip validation for `Merge ...` messages. |
| `ignore` | `[]` | Extra regular expressions for messages to skip. |
| `systemPrompt` | `true` | Register the system-prompt block. |
| `command` | `true` | Register `/commit`. |
| `registerSkill` | `true` | Register the bundled skill. |

Default types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`.

The CLI accepts `--types feat,fix,docs` and `--any-type` for the same policy.

## SemVer mapping

| Commit | Bump |
| --- | --- |
| any `!` or `BREAKING CHANGE:` footer | `major` |
| `feat:` | `minor` |
| `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`, `style:`, `chore:`, `revert:` | `patch` |
| no commits | `none` |

```bash
node skills/conventional-commits/scripts/cli.mjs bump --json
# { "bump": "minor", "from": "v1.2.0", "to": "HEAD", "commits": 7 }
```

## Repository layout

```
src/index.ts                     OpenCode V2 plugin
skills/conventional-commits/
  SKILL.md                       agent instructions (progressive disclosure)
  references/                    spec, types, examples, release workflow
  scripts/conventional-commits.mjs   parser, validator, changelog, shell inspector
  scripts/cli.mjs                portable CLI
  scripts/claude-hook.mjs        Claude Code PreToolUse hook
  scripts/git-commit-msg.mjs     git commit-msg hook
  scripts/install.mjs            git hook installer
bin/conventional-commits.mjs     npm bin wrapper
.claude-plugin/                  Claude Code plugin and marketplace manifests
hooks/hooks.json                 Claude Code hook wiring
commands/commit.md               Claude Code /commit command
tests/                           engine, CLI, hook, and plugin tests
```

The engine has no dependencies and no build step. The skill directory is self-contained: copy it into any `skills/` folder and its scripts keep working.

## Development

```bash
npm install
npm test          # node --test
npm run typecheck # tsc --noEmit
```

Commits to this repository are validated by the same rules; install the hook before contributing:

```bash
node skills/conventional-commits/scripts/install.mjs
```

## License and attribution

Code is [MIT](LICENSE).

The specification text is © the Conventional Commits contributors and licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). `skills/conventional-commits/references/spec.md`
restates it with attribution; the [published specification](https://www.conventionalcommits.org/en/v1.0.0/) is authoritative.

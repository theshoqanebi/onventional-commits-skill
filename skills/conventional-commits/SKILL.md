---
name: conventional-commits
description: Write, validate, and release Conventional Commits 1.0.0. Use when composing a commit message, reviewing commit history, generating a changelog, or deciding a SemVer bump.
license: MIT
---

# Conventional Commits

Every commit message in this repository follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The convention is enforced: a non-conforming message is rejected, not corrected silently.

## The format

```
<type>[(scope)][!]: <description>

[optional body]

[optional footer(s)]
```

A real message:

```
feat(parser)!: support arrays in config values

Config values may now be arrays, so repeated keys are no longer needed.
The parser reads the first value and folds the rest into an array.

BREAKING CHANGE: `config.get("key")` returns `unknown[]` instead of `unknown`
when the key appears more than once. Call `config.getOne("key")` for the old
behaviour.

Refs: #482
Reviewed-by: Z
```

## Rules that actually bite

1. **Header shape.** `<type>[(scope)][!]: <description>` — one colon, one space, description on the same line.
2. **Type is required and lowercase.** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`. A repository may allow more; ask before inventing one.
3. **Scope is optional and a single noun.** `feat(parser):`, `fix(api):`. No spaces, no empty `()`. Lowercase by convention.
4. **Description is imperative and short.** "add", "fix", "remove" — not "added", "fixes", "removing". No trailing period. Keep the header at or under 100 characters.
5. **A body starts after exactly one blank line.** If there is no blank line, git treats the body as part of the description and tools lose the structure.
6. **Footers start after one blank line**, one per line, as `Token: value` or `Token #value`. Tokens use hyphens: `Reviewed-by`, `Co-authored-by`, `Refs`. `BREAKING CHANGE` is the exception and keeps its space.
7. **Breaking changes** use `!` before the colon, a `BREAKING CHANGE: <description>` footer, or both. Both is best: the `!` is visible in `git log --oneline`, the footer carries the migration instructions.
8. **Reverts** use the `revert` type and a `Refs:` footer naming the reverted commit.

Everything else in the specification is a variation on these eight.

## Writing a commit

```bash
# 1. See the change
git status --short
git diff --cached          # staged; leave out --cached to review everything

# 2. Pick the type from the user's point of view
#    feat  a capability that did not exist
#    fix   a defect in existing behaviour
#    perf  same behaviour, less work
#    refactor  same behaviour, different structure
#    docs, test, build, ci, style, chore  everything else

# 3. Write the message, then validate it before committing
node <skill>/scripts/cli.mjs validate -m "feat(api): add cursor pagination"

# 4. Commit, one -m per section
git commit -m "feat(api): add cursor pagination" \
           -m "Clients can now page large result sets without loading everything." \
           -m "Refs: #482"
```

Prefer `-m` over an editor: the message can be validated before the commit exists. Never bypass enforcement with `--no-verify`.

## Validating

If the OpenCode plugin is active, call the `validate_commit` tool with the exact final message. Otherwise use the bundled CLI, which needs only Node:

| Where the skill lives | Command |
| --- | --- |
| Project skill (`.claude/skills`, `.agents/skills`, `.opencode/skills`) | `node .claude/skills/conventional-commits/scripts/cli.mjs` |
| Claude Code plugin | `node "$CLAUDE_PLUGIN_ROOT/skills/conventional-commits/scripts/cli.mjs"` |
| This repository | `node skills/conventional-commits/scripts/cli.mjs` |

Subcommands:

```bash
node cli.mjs validate -m "feat: x"          # exit 0 valid, 1 invalid
node cli.mjs validate -F .git/COMMIT_EDITMSG
node cli.mjs suggest -m "feat add parser"   # mechanically repaired message
node cli.mjs check-command -c 'git commit -m "x"'   # inspect a shell command
node cli.mjs bump --from v1.2.0             # major | minor | patch | none
node cli.mjs changelog --version 1.3.0      # grouped Markdown release notes
node cli.mjs install-hooks                  # git commit-msg hook for this repo
```

Add `--types feat,fix,docs` to allow a different type list, or `--any-type` to accept any type as rule 14 permits.

## Releasing

| Change in the range | Bump |
| --- | --- |
| any `BREAKING CHANGE` or `!` | major |
| any `feat` | minor |
| only `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert` | patch |
| no commits | none |

```bash
node cli.mjs bump --from v1.2.0                    # decide the next version
node cli.mjs changelog --from v1.2.0 --version 1.3.0 > notes.md
```

Never change a released version. Never publish a major bump without documenting the migration in the `BREAKING CHANGE` footer.

## Do not

- Add `--no-verify`, `--no-gpg-sign`, or any other enforcement bypass.
- `git commit --amend` or force-push without explicit permission.
- Stage unrelated files to make a commit "complete".
- Write `WIP`, `fix`, `update`, `changes`, `stuff`, or emoji-only subjects.
- Capitalise the type (`Fix:`) or end the description with a period.
- Put `BREAKING CHANGE` in the body without a blank line before it.

## References

- `references/spec.md` — the sixteen rules, the grammar, and the FAQ.
- `references/types.md` — every type and its SemVer effect.
- `references/examples.md` — good and bad messages side by side.
- `references/release.md` — changelog format and release workflow.
- [Full specification](https://www.conventionalcommits.org/en/v1.0.0/)

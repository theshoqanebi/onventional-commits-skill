# Releasing from commit history

Conventional Commits exists so a release can be derived from history instead of
maintained by hand. This page covers the workflow the bundled tools support.

## 1. Decide the bump

```
major   some commit has "!" or a BREAKING CHANGE: footer
minor   otherwise, some commit has the type feat
patch   otherwise, at least one commit
none    the range is empty
```

The highest applicable rule wins. This is the whole of Semantic Versioning as it
applies to commits:

| From | `PATCH` | `MINOR` | `MAJOR` |
| --- | --- | --- | --- |
| `1.4.2` | `1.4.3` | `1.5.0` | `2.0.0` |
| `0.7.3` | `0.7.4` | `0.8.0` | `1.0.0` |

Ask the tool instead of reasoning about it:

```bash
node cli.mjs bump                       # since the latest tag
node cli.mjs bump --from v1.2.0 --to HEAD
node cli.mjs bump --json                # { bump, from, to, commits }
```

`--from` defaults to the most recent tag reachable from `HEAD`. Pass an explicit
ref when the tag does not exist yet or when releasing a maintenance branch.

## 2. Generate the notes

```bash
node cli.mjs changelog --from v1.2.0 --version 1.3.0 --date 2026-04-01
```

The result is Markdown grouped by type, with breaking changes first:

```markdown
## [1.3.0] - 2026-04-01

### Breaking Changes

- **api:** `/v1/*` requests fail with 410 Gone (1a2b3c4)

### Features

- **api:** add cursor pagination (5d6e7f8)

### Bug Fixes

- handle an empty scope (9a0b1c2)
```

Options:

| Flag | Effect |
| --- | --- |
| `--from <ref>` | Start of the range. Defaults to the latest tag. |
| `--to <ref>` | End of the range. Defaults to `HEAD`. |
| `--version <value>` | Heading version. Omit for an `Unreleased` section. |
| `--date <YYYY-MM-DD>` | Release date. Defaults to today. |
| `--no-hash` | Omit the short commit hashes. |
| `--json` | Emit `{ markdown, bump, groups, breaking, commitCount, from, to }`. |

Feed the output into `CHANGELOG.md` above the previous release. Do not rewrite
an entry that has already been published.

## 3. Tag and publish

```bash
# after merging the changelog commit
git tag -a v1.3.0 -m "v1.3.0"
git push origin v1.3.0
```

Tag names are not part of Conventional Commits; `v1.3.0` is a convention, not a
rule. Pick one prefix and keep it, because `git describe --tags --abbrev=0` (and
therefore the default `--from`) depends on a consistent shape.

## 4. Handle history that predates the convention

`bump` and `changelog` ignore commits they cannot parse rather than failing:

- a message without a type contributes to the count but no group, so a large
  legacy range can hide a breaking change.
- merge commits, `fixup!`, `squash!`, and generated `Revert "..."` messages are
  ignored on purpose.

When adopting the convention on an existing repository, start the range at a
tag you trust:

```bash
node cli.mjs changelog --from v2.0.0 --version 2.1.0
```

`commit-msg` hooks and agent-side enforcement apply only to new commits; they
never rewrite history.

## 0.x releases

Below `1.0.0` every change may break. Still mark breaking changes with `!` and a
`BREAKING CHANGE:` footer: the mapping to `MAJOR` is what makes the eventual
`1.0.0` release meaningful, and the footer is where consumers read the
migration.

A common policy for `0.y.z` is to bump `MINOR` for breaking changes and `PATCH`
for everything else until `1.0.0`. If you adopt it, say so in `AGENTS.md`; the
tool reports the specification's mapping, not your local policy.

## Prereleases

`1.4.0-rc.1` is a valid SemVer version but not something the changelog tool
derives. Decide the prerelease yourself and pass it as `--version`:

```bash
node cli.mjs changelog --from v1.3.0 --version 1.4.0-rc.1
```

Do not move a tag after publishing it. Publish `-rc.2` instead.

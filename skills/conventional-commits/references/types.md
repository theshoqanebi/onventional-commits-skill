# Types and scopes

The specification requires `feat` and `fix` and allows any other type (rule 14).
This project's tools accept the eleven below by default. A repository may narrow
or widen the list; `--any-type` accepts anything.

## The default types

| Type | Use it when | SemVer |
| --- | --- | --- |
| `feat` | The change adds a capability a user or consumer can observe. | `MINOR` |
| `fix` | The change corrects behaviour that was wrong. | `PATCH` |
| `perf` | The change makes existing behaviour faster or cheaper. No API change. | `PATCH` |
| `refactor` | The change restructures code without changing behaviour. | `PATCH` |
| `docs` | Documentation, comments, README, changelog, API reference. | `PATCH` |
| `test` | Tests, fixtures, test helpers. No production code. | `PATCH` |
| `build` | Build system, bundler, dependencies, packaging, Dockerfiles. | `PATCH` |
| `ci` | Continuous integration, pipelines, release automation. | `PATCH` |
| `style` | Formatting, whitespace, semicolons, lint fixes with no behaviour change. | `PATCH` |
| `chore` | Maintenance that fits nowhere else: generated files, version bumps, repo hygiene. | `PATCH` |
| `revert` | Reverting an earlier commit. | `PATCH` |

Any type, including the eleven above, becomes `MAJOR` when it carries `!` or a
`BREAKING CHANGE:` footer. See `spec.md` for the mapping.

## Choosing between the easy-to-confuse ones

**`feat` vs `refactor`** — can a consumer of the code tell the difference? A new
option, endpoint, export, or behaviour is `feat`. Moving the same function to a
different file is `refactor`.

**`fix` vs `perf`** — was the old behaviour wrong, or just slow? Wrong is `fix`.
A performance improvement that changes nothing observable is `perf`.

**`refactor` vs `style`** — `style` changes only what the formatter sees:
whitespace, quotes, semicolons. `style` should be reviewable by ignoring
whitespace. Anything that changes the syntax tree is `refactor`.

**`build` vs `ci`** — `build` is how the artifact is produced (TypeScript config,
bundler, dependency bump, Dockerfile). `ci` is how it is tested and shipped
(GitHub Actions, release workflow, caching).

**`chore` vs everything** — `chore` is the fallback, not a synonym for "small".
If the change touches tests, use `test`. If it touches docs, use `docs`.

**`fix` vs `feat` for a regression in an unreleased feature** — if the feature
has never shipped, `feat` still describes the consumer-visible result. Once
shipped, a defect is `fix`.

## Scopes

A scope names the area a change touches. It is optional, but a monorepo or a
package with distinct modules benefits from always using one.

Good scopes:

- a module or directory: `parser`, `api`, `cli`, `auth`, `db`
- a package: `web`, `server`, `sdk`
- a dependency, for dependency bumps: `build(deps)`, `build(deps-dev)`

Avoid:

- the type repeated as a scope: `feat(feature):`
- a sentence: `fix(this thing in the parser):`
- a ticket number: put that in a `Refs:` footer instead
- an empty scope: `fix():` is a violation

Set `requireScope: true` (plugin) or maintain a convention in `AGENTS.md` when
every commit should name its area.

## Multiple concerns

One commit, one intent. A change that adds an endpoint *and* renames a config key
*and* fixes a typo is three commits. If they must ship together, the type is the
highest-impact one (`feat`) and the body lists the rest. Splitting is always
better: a `revert` of one concern stays possible.

# Examples

Every example below is complete: the first message is the whole commit, body and
footers included. "Rejected" means this project's validator returns a violation,
not just a style warning.

## The canonical shapes

```
feat: allow provided config object to extend other configs
```
```
fix: prevent racing of requests
```
```
feat(lang): add Polish language
```
```
docs: correct spelling of CHANGELOG
```

## With a body and footers

```
fix: prevent racing of requests

Introduce a request id and a reference to latest request. Dismiss
incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
Refs: #123
```

Note the two blank lines: one after the description, one before the footer
block. `Refs: #123` uses the ` #` separator, which the specification also
allows.

## Breaking changes

Prefix marker:

```
feat!: send an email to the customer when a product is shipped
```

Prefix marker plus a migration footer — the recommended form for anything a
consumer must act on:

```
feat(api)!: remove the legacy /v1 endpoints

The /v1 endpoints have been deprecated since 2.0 and now return 410.

BREAKING CHANGE: `/v1/*` requests fail with 410 Gone. Migrate to `/v2/*`;
the request and response bodies are unchanged.
```

Footer only:

```
feat: allow config to be supplied as an object

BREAKING CHANGE: the `config` argument is now an object instead of a JSON
string. Callers that passed a string must parse it first.
```

A breaking change on a type that is not `feat` or `fix` is still a `MAJOR`:

```
chore!: require Node.js 20

BREAKING CHANGE: Node.js 18 is no longer supported. Upgrade the runtime
before updating this package.
```

## Reverts

```
revert: let us never again speak of the noodle incident

Refs: 676104e, a215868
```

`git revert` writes `Revert "feat: add the noodle feature"` on the first line.
The tools ignore that generated form rather than forcing a rewrite; when you
write the revert by hand, use the `revert` type above.

## Dependency updates

```
build(deps): bump typescript from 5.6.3 to 5.7.2
```
```
build(deps-dev): bump vitest from 1.6.0 to 2.1.8

Refs: #512
```

## Rejected examples

Each of these fails validation. The fix is shown after the arrow.

| Message | Problem | Fix |
| --- | --- | --- |
| `feat add parser` | rule 1 — no colon | `feat: add parser` |
| `feat:add parser` | rule 1 — no space after the colon | `feat: add parser` |
| `feat(): add parser` | rule 4 — empty scope | `feat: add parser` |
| `feat(parser)! add arrays` | rule 13 — `!` is before the scope, and the colon is missing | `feat(parser)!: add arrays` |
| `FEAT!: drop Node 18` | rule 15 style warning — uppercase type | `feat!: drop Node 18` |
| `feat: add parser.` | rule 5 style warning — trailing period | `feat: add parser` |
| `feat: add parser\nBody text` | rule 6 — no blank line after the description | insert a blank line |
| `feat: add parser\n\nBREAKING CHANGE: removed x` | valid, but a `MAJOR` bump hidden behind a `feat` — that is allowed; prefer `feat!:` so the marker is visible in `git log --oneline` |
| `breaking change: removed x` | rule 15 — the token must be uppercase | `BREAKING CHANGE: removed x` |
| `feat: add parser\n\nBreaking-Change: removed x` | rule 16 allows `BREAKING-CHANGE`, not mixed case | `BREAKING CHANGE: removed x` |
| `update stuff` | rule 1 — no type | `chore: update the lockfile` |
| `fix: ` | rule 5 — empty description | describe the fix |
| `WIP` | rule 1 — no type | do not commit a work in progress |

## Rejected bodies and footers

```
feat: add parser
BREAKING CHANGE: array values now return arrays
```
Rejected: rule 6. Without the blank line the footer is part of the description,
so no tool sees the breaking change.

```
feat: add parser

BREAKING CHANGE:array values now return arrays
```
Rejected: rule 12. The token needs one colon and one space.

```
feat: add parser

Reviewed by: Z
```
Rejected: rule 9. Footer tokens use hyphens: `Reviewed-by: Z`.

```
feat: add parser

Refs:
```
Rejected: rule 8. A footer needs a value.

```
feat: add parser

Body paragraph.

Refs: #123
Refs: #456
```
Accepted. Repeated tokens are allowed; rule 10 stops one footer's value at the
next token.

## Changelog output

`node cli.mjs changelog --from v1.2.0 --version 1.3.0 --date 2026-04-01`
renders:

```markdown
## [1.3.0] - 2026-04-01

### Features

- **api:** add cursor pagination (1a2b3c4)
- **parser:** support arrays in config values (5d6e7f8)

### Bug Fixes

- handle an empty scope (9a0b1c2)

### Documentation

- explain the retry policy (3d4e5f6)
```

Breaking changes are lifted into a `### Breaking Changes` section above the type
groups, with the text from the footer rather than the description.

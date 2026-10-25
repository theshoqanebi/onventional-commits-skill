# The specification, restated

> Source: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
> © Conventional Commits contributors, licensed
> [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). This page restates
> the rules with examples; the linked specification is authoritative.

## Summary

The Conventional Commits specification is a lightweight convention on top of
commit messages. It provides an easy set of rules for creating an explicit
commit history, which makes writing automated tools on top of it easier. By
describing features, fixes, and breaking changes in commit messages, the
convention dovetails with [Semantic Versioning](https://semver.org/).

## The grammar

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

A commit contains the following structural elements, to communicate intent to
consumers of your library:

1. **fix** — a commit of the type `fix` patches a bug in your codebase (this
   correlates with `PATCH` in Semantic Versioning).
2. **feat** — a commit of the type `feat` introduces a new feature (this
   correlates with `MINOR`).
3. **BREAKING CHANGE** — a commit that has a footer `BREAKING CHANGE:`, or
   appends a `!` after the type/scope, introduces a breaking API change
   (correlates with `MAJOR`). A breaking change can be part of any type.
4. Types other than `feat` and `fix` are allowed, for example `docs:`, `test:`,
   `build:`.

## The sixteen rules

1. Commits MUST be prefixed with a type: a noun such as `feat` or `fix`,
   followed by the OPTIONAL scope, the OPTIONAL `!`, and the REQUIRED terminal
   colon and space.
2. `feat` MUST be used when a commit adds a new feature to the application or
   library.
3. `fix` MUST be used when a commit represents a bug fix.
4. A scope MAY follow the type. It MUST be a noun describing a section of the
   codebase, surrounded by parentheses: `fix(parser):`.
5. A description MUST immediately follow the colon and space. It is a short
   summary of the change: `fix: array parsing issue when multiple spaces were
   contained in string`.
6. A longer body MAY follow the description with additional context. The body
   MUST begin one blank line after the description.
7. The body is free-form and MAY consist of any number of newline-separated
   paragraphs.
8. One or more footers MAY follow one blank line after the body. Each footer
   MUST consist of a word token, then either `: ` or ` #`, then a string value
   (inspired by the git trailer convention).
9. A footer token MUST use `-` in place of whitespace: `Acked-by`. This
   distinguishes the footer section from a multi-paragraph body. `BREAKING
   CHANGE` is an exception and MAY also be used as a token.
10. A footer value MAY contain spaces and newlines. Parsing terminates at the
    next valid footer token/separator pair.
11. Breaking changes MUST be indicated in the type/scope prefix, in the footer,
    or both.
12. A breaking-change footer MUST consist of the uppercase text `BREAKING
    CHANGE`, a colon, a space, and a description.
13. A breaking change in the prefix MUST be indicated by `!` immediately before
    the colon. When `!` is used, a `BREAKING CHANGE:` footer MAY be omitted and
    the description describes the breaking change.
14. Types other than `feat` and `fix` MAY be used: `docs: update ref docs`.
15. Implementors MUST NOT treat the units of information as case sensitive,
    with the exception of `BREAKING CHANGE`, which MUST be uppercase.
16. `BREAKING-CHANGE` MUST be synonymous with `BREAKING CHANGE` as a footer
    token.

## Semantic Versioning mapping

| Commit | Release |
| --- | --- |
| `fix: ...` | `PATCH` |
| `feat: ...` | `MINOR` |
| `BREAKING CHANGE: ...` or `<type>!: ...` | `MAJOR` |

A `1.0.0` release is required for a project to adopt Semantic Versioning
publicly; `0.y.z` is for initial development, where anything may change.

## FAQ highlights

**How do I write a multi-line description or a rare type?**
The description is one line. Put the detail in the body. Types beyond the
recommended list are allowed by rule 14; a repository may narrow that list, and
this project's validator does (`--any-type` relaxes it).

**Does case matter?**
Rule 15 says the units are not case sensitive, so `FEAT: x` conforms. This
project warns on an uppercase type because a consistent history greps better.

**What if my change fits two types?**
Pick the type that matters most to a consumer of the change — usually `feat` or
`fix`. Split the commit if the two changes are independent.

**How do I revert a commit?**
Use `revert:` with a body quoting the original description and a `Refs:` footer
naming the commit. `git revert` generates `Revert "..."`, which this project
ignores for compatibility.

**Why does a missing blank line matter?**
Git stores the message verbatim; only the first line is the subject. Without the
blank line, footers and `BREAKING CHANGE` stay inside the description, where no
tool can read them.

**Is `BREAKING CHANGE` required with `!`?**
No, rule 13 makes it optional. Add the footer anyway when a migration is not
obvious — the `!` says *that* something broke, the footer says *what* and *how
to fix it*.

**Can a breaking change be a chore?**
Yes. Rule 11 does not restrict the type; `chore!: drop Node 18` is valid and is
still a `MAJOR` bump.

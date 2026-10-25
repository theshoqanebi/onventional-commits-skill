---
description: Write and validate a Conventional Commit for the staged changes
argument-hint: [scope or extra context]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git commit:*), Bash(node:*), Read
---

Create a Conventional Commits 1.0.0 commit for the staged changes.

1. Inspect what is staged: run `git status --short` and `git diff --cached`.
   If nothing is staged, stop and say so. Do not stage files the user did not
   mention.
2. Choose the type that describes the change from a user's point of view:
   `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`,
   `chore`, or `revert`. Add a scope naming the affected area when it is not
   obvious.
3. Write the message:

   ```
   <type>[(scope)][!]: <description>

   [optional body]

   [optional footer(s)]
   ```

   - description: imperative mood, no trailing period, at most 100 characters
   - body: one blank line after the description; explain why, not what
   - footers: one blank line after the body, `Token: value`, hyphenated tokens
   - breaking: `!` before the colon and a `BREAKING CHANGE: <migration>` footer

4. Validate the exact final message before committing:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/conventional-commits/scripts/cli.mjs" validate -m "<header>"
   ```

   Fix every reported problem. Warnings are style, not failures, but aiming for
   zero is better.

5. Commit with one `-m` per section:

   ```bash
   git commit -m "feat(api): add cursor pagination" \
              -m "Clients can now page large result sets." \
              -m "Refs: #482"
   ```

   Never use `--no-verify`, never amend, and never push unless asked.

6. Report the new commit hash and the message you used.

Additional context: $ARGUMENTS

/**
 * Type declarations for the Conventional Commits engine.
 *
 * They describe the dependency-free JavaScript implementation in
 * `conventional-commits.mjs` so TypeScript consumers (the OpenCode plugin)
 * get autocomplete and checking without a build step for the engine.
 */

export type Bump = "major" | "minor" | "patch"

export interface Problem {
  rule: number
  message: string
  fix?: string
}

export interface Footer {
  token: string
  separator: string
  value: string
}

export type Structure = "header-only" | "body" | "footers" | "body+footers" | "missing-blank-line"

export interface ParsedCommit {
  raw: string
  header: string
  headerValid: boolean
  type: string | null
  typeRaw: string | null
  scope: string | null
  breaking: boolean
  description: string | null
  body: string
  footers: Footer[]
  breakingDescription: string | null
  structure: Structure
}

export interface ValidateOptions {
  /** Allowed types. `null` accepts any type, as rule 14 permits. Defaults to {@link DEFAULT_TYPES}. */
  types?: readonly string[] | null | false
  /** Header length that triggers a warning. Defaults to 100. */
  maxHeaderLength?: number
  /** Turn the header length warning into a violation. */
  enforceHeaderLength?: boolean
  /** Require a scope on every commit. */
  requireScope?: boolean
  /** Accept merge commits without validation. Defaults to true. */
  allowMergeCommits?: boolean
  /** Extra regular expressions for messages that should be ignored. */
  ignore?: ReadonlyArray<string | RegExp>
  /** Reader used to resolve `git commit -F <file>` in a shell command. */
  readFile?: (path: string) => string | null
}

export interface ValidationResult {
  valid: boolean
  ignored: boolean
  parsed: ParsedCommit
  violations: Problem[]
  warnings: Problem[]
  bump: Bump | null
}

export interface ChangelogEntry {
  message: string
  hash?: string
  author?: string
  date?: string
}

export interface ChangelogOptions {
  version?: string
  date?: string
  includeHash?: boolean
}

export interface ChangelogResult {
  markdown: string
  bump: Bump | null
  groups: Record<string, Array<{ scope: string | null; description: string; hash?: string }>>
  breaking: Array<{ scope: string | null; description: string; hash?: string }>
  commitCount: number
}

export type InvocationKind = "inline" | "file" | "stdin" | "missing" | "reused"

export interface ShellInvocation {
  command: string
  message: string | null
  file: string | null
  kind: InvocationKind
  amend: boolean
}

export interface ShellFinding {
  kind: "invalid" | "missing-message" | "unverified-file"
  invocation: ShellInvocation
  result?: ValidationResult
}

export interface CheckResult {
  blocked: boolean
  findings: ShellFinding[]
  invocations: ShellInvocation[]
  options: ValidateOptions
}

export interface GitCommit {
  hash: string
  author: string
  date: string
  message: string
}

export const SPEC_URL: "https://www.conventionalcommits.org/en/v1.0.0/"
export const DEFAULT_TYPES: readonly string[]
export const TYPE_ORDER: readonly string[]
export const TYPE_TITLES: Readonly<Record<string, string>>
export const CONVENTION_BLOCK: string

export function parseCommit(input: string): ParsedCommit
export function isIgnoredMessage(message: string, options?: ValidateOptions): boolean
export function validateCommit(input: string, options?: ValidateOptions): ValidationResult
export function suggestMessage(input: string, options?: ValidateOptions): string | null
export function bumpForMessage(message: string, options?: ValidateOptions): Bump | null
export function recommendBump(
  entries: ReadonlyArray<string | ChangelogEntry>,
  options?: ValidateOptions,
): Bump | null
export function buildChangelog(
  entries: ReadonlyArray<string | ChangelogEntry>,
  options?: ChangelogOptions,
): ChangelogResult
export function formatValidation(result: ValidationResult): string
export function formatBlockedMessage(result: CheckResult): string
export function splitShellCommand(command: string): Array<{ segment: string; heredoc: string | null }>
export function shellWords(value: string): string[]
export function extractGitCommitInvocations(command: string): ShellInvocation[]
export function checkShellCommand(command: string, options?: ValidateOptions): CheckResult
export function readGitCommits(input?: { from?: string; to?: string; cwd?: string }): GitCommit[]
export function latestTag(cwd?: string): string | null

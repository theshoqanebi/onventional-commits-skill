import test from "node:test"
import assert from "node:assert/strict"
import { isAbsolute } from "node:path"

// The plugin is TypeScript, so importing it needs a Node.js with built-in type
// stripping (22.18+). Older versions skip these tests instead of failing.
const pluginModule = await import("../src/index.ts").catch((error) => {
  const message = String(error?.message ?? error)
  if (/Unknown file extension|strip-types|ERR_UNKNOWN_FILE_EXTENSION|TypeScript/i.test(message)) return null
  throw error
})

const plugin = pluginModule?.default
const PLUGIN_ID = pluginModule?.PLUGIN_ID
const SKILL_ID = pluginModule?.SKILL_ID
const pluginTest = pluginModule ? test : test.skip

/**
 * Minimal stand-in for the OpenCode plugin context: it records whatever the
 * plugin registers and exposes the same async shapes the real domains use.
 *
 * @param {{ options?: Record<string, unknown>, existingSkills?: string[] }} [input]
 */
function fakeContext(input = {}) {
  /** @type {any} */
  const state = {
    tools: [],
    commands: [],
    skills: [],
    sessionHooks: [],
    toolHooks: [],
    prompts: [],
  }

  const context = {
    options: input.options ?? {},
    location: { directory: process.cwd() },
    session: {
      hook: async (name, callback) => {
        state.sessionHooks.push({ name, callback })
      },
      prompt: async (prompt) => {
        state.prompts.push(prompt)
      },
    },
    tool: {
      transform: async (callback) => {
        callback({ add: (tool) => state.tools.push(tool) })
      },
      hook: async (name, callback) => {
        state.toolHooks.push({ name, callback })
      },
    },
    command: {
      transform: async (callback) => {
        callback({ add: (command) => state.commands.push(command) })
      },
    },
    skill: {
      list: async () => ({
        location: {},
        data: (input.existingSkills ?? []).map((id) => ({ id })),
      }),
      transform: async (callback) => {
        callback({ add: (skill) => state.skills.push(skill) })
      },
    },
  }

  return { context, state }
}

/** @param {any} state */
function tool(state, name) {
  const found = state.tools.find((entry) => entry.name === name)
  assert.ok(found, `expected the ${name} tool to be registered`)
  return found
}

pluginTest("registers the tools, command, skill, and prompt hook", async () => {
  const { context, state } = fakeContext()
  await plugin.setup(context)

  assert.equal(PLUGIN_ID, "conventional-commits")
  assert.deepEqual(
    state.tools.map((entry) => entry.name).sort(),
    ["commit_changelog", "validate_commit"],
  )
  assert.equal(state.commands[0].name, "commit")
  assert.equal(state.skills.length, 1)
  assert.equal(state.skills[0].id, SKILL_ID)
  assert.equal(state.skills[0].name, "Conventional Commits")
  assert.ok(isAbsolute(state.skills[0].path))
  assert.match(state.skills[0].path, /SKILL\.md$/)
  assert.match(state.skills[0].content, /## The format/)
  // Frontmatter is stripped before the skill body is registered.
  assert.doesNotMatch(state.skills[0].content, /^---/)
  assert.equal(state.sessionHooks[0].name, "context")
  assert.equal(state.toolHooks[0].name, "execute.before")
})

pluginTest("does not duplicate the prompt block or an existing skill", async () => {
  const { context, state } = fakeContext({ existingSkills: [SKILL_ID] })
  await plugin.setup(context)

  const event = { system: [], tools: {}, options: {}, messages: [] }
  state.sessionHooks[0].callback(event)
  state.sessionHooks[0].callback(event)

  const blocks = event.system.filter((part) => part.text.includes("Conventional Commits 1.0.0"))
  assert.equal(blocks.length, 1)
  assert.equal(state.skills.length, 0)
})

pluginTest("validate_commit reports problems and the SemVer bump", async () => {
  const { context, state } = fakeContext()
  await plugin.setup(context)
  const validate = tool(state, "validate_commit")

  const bad = await validate.execute({ message: "feat add parser" })
  assert.match(bad.content, /FAIL: 1 problem/)
  assert.equal(bad.metadata.valid, false)
  assert.equal(bad.metadata.violations, 1)

  const good = await validate.execute({ message: "feat(api)!: drop the v1 endpoints" })
  assert.match(good.content, /OK: message conforms/)
  assert.equal(good.metadata.valid, true)
  assert.equal(good.metadata.bump, "major")
  assert.equal(good.metadata.type, "feat")
  assert.equal(good.metadata.scope, "api")
  assert.equal(good.metadata.breaking, true)
})

pluginTest("validate_commit honours the plugin type list", async () => {
  const { context, state } = fakeContext({ options: { types: ["feat", "fix"] } })
  await plugin.setup(context)
  const validate = tool(state, "validate_commit")

  const rejected = await validate.execute({ message: "docs: explain the retry policy" })
  assert.equal(rejected.metadata.valid, false)

  const permissive = fakeContext({ options: { types: null } })
  await plugin.setup(permissive.context)
  const any = await tool(permissive.state, "validate_commit").execute({ message: "deps: bump express" })
  assert.equal(any.metadata.valid, true)
})

pluginTest("the shell hook rejects an invalid commit and allows a valid one", async () => {
  const { context, state } = fakeContext()
  await plugin.setup(context)
  const hook = state.toolHooks[0].callback

  assert.throws(
    () => hook({ tool: "bash", input: { command: 'git commit -m "feat add parser"' } }),
    /Commit blocked by conventional-commits[\s\S]*\[rule 1\]/,
  )

  assert.doesNotThrow(() => hook({ tool: "bash", input: { command: 'git commit -m "fix: handle empty scope"' } }))
  assert.doesNotThrow(() => hook({ tool: "bash", input: { command: "npm test" } }))
  assert.doesNotThrow(() => hook({ tool: "read", input: { file_path: "README.md" } }))
  assert.doesNotThrow(() => hook({ tool: "bash", input: {} }))
})

pluginTest("strict mode can be turned off", async () => {
  const { context, state } = fakeContext({ options: { strict: false } })
  await plugin.setup(context)
  assert.equal(state.toolHooks.length, 0)
})

pluginTest("the /commit command forwards to the session with instructions", async () => {
  const { context, state } = fakeContext()
  await plugin.setup(context)

  const command = state.commands[0]
  await command.execute({
    sessionID: "ses_test",
    prompt: { text: "scope api" },
    delivery: "steer",
  })

  assert.equal(state.prompts.length, 1)
  const prompt = state.prompts[0]
  assert.equal(prompt.sessionID, "ses_test")
  assert.equal(prompt.delivery, "steer")
  assert.match(prompt.text, /Conventional Commits 1\.0\.0/)
  assert.match(prompt.text, /git diff --cached/)
  assert.match(prompt.text, /## Additional instruction\n\nscope api/)
})

pluginTest("commit_changelog includes release notes and a bump", async () => {
  const { context, state } = fakeContext()
  await plugin.setup(context)
  const changelog = tool(state, "commit_changelog")

  // Read-only against this checkout; an empty range must still render.
  const result = await changelog.execute({ from: "HEAD", to: "HEAD", version: "9.9.9", date: "2026-01-01" })
  assert.match(result.content, /Recommended bump: none/)
  assert.match(result.content, /## \[9\.9\.9\]/)
  assert.equal(result.metadata.commits, 0)
})

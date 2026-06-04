# opencode-mcp

An MCP server that exposes the local [OpenCode](https://opencode.ai) HTTP API as tools, letting Claude Code (or any MCP client) spawn and manage OpenCode agent sessions.

## Prerequisites

- Node.js 18+
- OpenCode running locally (default: `http://localhost:4096`)

## Setup

```bash
npm install
npm run build
```

## Tests

Requires a running OpenCode server (`OPENCODE_URL`, default `http://localhost:4096`).

```bash
npm test                    # all tests
npm run test:api            # API integration tests only
npm run test:conformance    # spec-vs-runtime conformance only
```

**`tests/api.test.ts`** — integration tests for every API helper: session creation, sync/async message send, fire+check pattern, provider listing, etc.

**`tests/conformance.test.ts`** — validates that the real HTTP responses from the running server match the shapes defined in `openapi.json`. Any field that the spec requires but the server doesn't return is reported as a failure. Known divergences (like `items` vs `data` in `/api/session`) are documented inline with the server version where they were first observed.

## Keeping up with OpenCode API changes

The TypeScript types in `src/openapi.d.ts` are generated from the [OpenCode OpenAPI spec](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/openapi.json). When OpenCode releases a new version:

```bash
npm run generate   # re-downloads openapi.json and regenerates src/openapi.d.ts
npm run build      # TypeScript surfaces any breaking changes as compile errors
```

Fix any errors the compiler flags, then commit both `openapi.json` and `src/openapi.d.ts`.

## Configuration

Add to your `~/.claude/settings.json` (or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "opencode": {
      "command": "node",
      "args": ["/absolute/path/to/opencode-mcp/dist/index.js"],
      "env": {
        "OPENCODE_URL": "http://localhost:4096",
        "OPENCODE_DEFAULT_PROVIDER": "opencode",
        "OPENCODE_DEFAULT_MODEL": "big-pickle"
      }
    }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_URL` | `http://localhost:4096` | Base URL of the OpenCode HTTP API |
| `OPENCODE_API_KEY` | _(none)_ | Bearer token sent as `Authorization: Bearer <key>` on every request. Set this if OpenCode is behind an authenticating proxy or a future version requires a key. |
| `OPENCODE_DEFAULT_PROVIDER` | `opencode` | Provider ID used when `provider_id` is not specified |
| `OPENCODE_DEFAULT_MODEL` | `big-pickle` | Model ID used when `model_id` is not specified |

## Tools

### `run`
Create a session, send a prompt, and **block until the agent finishes**. Returns the full assistant response.
Use this for short-to-medium tasks where you want the answer inline.

**Required:** `prompt`, `directory`  
**Optional:** `title`, `provider_id`, `model_id`

---

### `fire`
Create a session and send a prompt **without waiting** for completion. Returns the session ID immediately.
Use this to kick off long tasks in parallel; collect results later with `check`.

**Required:** `prompt`, `directory`  
**Optional:** `title`, `provider_id`, `model_id`

---

### `check`
Wait for a session to finish and return its final assistant response.
Pair with `fire` or `reply`.

**Required:** `session_id`, `directory`

---

### `reply`
Send a follow-up prompt to an **existing** session (fire-and-forget).
Use this to continue work when context usage is below ~55%; use `check` afterwards to collect the result.

**Required:** `session_id`, `prompt`, `directory`  
**Optional:** `provider_id`, `model_id`

---

### `messages`
Fetch all messages from a session, formatted as `[USER] / [ASSISTANT]` blocks.
Useful for auditing what a subagent did after it completed.

**Required:** `session_id`, `directory`

---

### `context_pct`
Estimate how much of the context window a session has consumed (chars ÷ 4 ≈ tokens, relative to a 200k limit).
Returns a safe-to-reuse flag at <55%. Use this to decide whether to `reply` to an existing session or `fire` a new one.

**Required:** `session_id`, `directory`

---

### `list_sessions`
List recent OpenCode sessions, optionally filtered by directory.

**Optional:** `directory`, `limit` (default 20)

---

### `session_status`
Fetch metadata for a session: title, model, agent, directory, file-change summary, and timestamps.
To wait for completion and get the response, use `check` instead.

**Required:** `session_id`

---

### `list_models`
List all connected providers and their available models.

**Optional:** `directory`

## Usage pattern

```
fire  →  (do other work)  →  check      # parallel tasks
run                                      # blocking single task
fire  →  check  →  context_pct  →  reply  →  check  # long multi-turn task
```

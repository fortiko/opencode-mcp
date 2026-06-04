/**
 * MCP protocol tests.
 *
 * Spawns the server as a subprocess and connects via the MCP stdio transport —
 * the same protocol Claude uses. Each test calls a tool with a fixed input and
 * asserts on the deterministic output format.
 *
 * Requires: a running OpenCode server (OPENCODE_URL, default localhost:4096)
 *           and a built dist/index.js (npm run build).
 *
 * Run:       npm test
 * One suite: npm run test:mcp
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = resolve(__dirname, "../dist/index.js");
const BASE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";

// Helper: extract the text from a tool result
function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error(`Expected text content, got ${first?.type}`);
  return first.text as string;
}

// ── Client lifecycle ──────────────────────────────────────────────────────────

let client: Client;

beforeAll(async () => {
  // Verify OpenCode is reachable before starting the server process
  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`OpenCode not reachable at ${BASE_URL} — start it before running tests`);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_BIN],
    env: { ...process.env, OPENCODE_URL: BASE_URL },
  });

  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
});

// ── Tool registration ─────────────────────────────────────────────────────────

describe("tool registration", () => {
  test("all 9 tools are listed with names and descriptions", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(expect.arrayContaining([
      "run", "fire", "check", "reply",
      "messages", "list_models", "list_sessions",
      "session_status", "context_pct",
    ]));
    expect(tools).toHaveLength(9);

    for (const tool of tools) {
      expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} should have an inputSchema`).toBeTruthy();
    }
  });
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("authentication", () => {
  test("wrong OPENCODE_API_KEY returns an error result, not a crash", async () => {
    // Spawn a separate server process with a bad token pointed at a non-existent server
    // so the 401/connection error is surfaced as an MCP error content block, not a process crash.
    const badTransport = new StdioClientTransport({
      command: "node",
      args: [SERVER_BIN],
      env: { ...process.env, OPENCODE_URL: "http://localhost:9999", OPENCODE_API_KEY: "bad-token" },
    });
    const badClient = new Client({ name: "test-bad-auth", version: "1.0.0" });
    await badClient.connect(badTransport);

    try {
      const result = await badClient.callTool({ name: "list_models", arguments: {} });
      // The tool should return isError content, not throw
      const text = resultText(result);
      expect(text).toMatch(/^Error:/);
    } finally {
      await badClient.close();
    }
  });
});

// ── Read-only tools (no sessions created) ────────────────────────────────────

describe("list_models", () => {
  test("returns connected providers with at least one model", async () => {
    const result = await client.callTool({ name: "list_models", arguments: {} });
    const text = resultText(result);

    expect(text).toMatch(/^Connected providers:/m);
    expect(text).toMatch(/^## .+ \(.+\)$/m);      // ## Provider Name (id)
    expect(text).toMatch(/^\s+- \S+/m);           // - model-id
  });
});

describe("list_sessions", () => {
  test("returns lines in 'ses_id | title | dir' format", async () => {
    const result = await client.callTool({ name: "list_sessions", arguments: { limit: 5 } });
    const text = resultText(result);

    if (text === "(no sessions)") return; // empty install, nothing to assert

    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      // Each line: ses_<id> | <title> | <directory>
      expect(line, `unexpected line format: "${line}"`).toMatch(/^ses_\w+ \| .* \| /);
    }
  });

  test("respects the limit argument", async () => {
    const result = await client.callTool({ name: "list_sessions", arguments: { limit: 3 } });
    const text = resultText(result);

    if (text === "(no sessions)") return;
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

// ── Session lifecycle tools ───────────────────────────────────────────────────

describe("run", () => {
  test("creates a session, runs a prompt, and returns the session ID + response", async () => {
    const result = await client.callTool({
      name: "run",
      arguments: { prompt: "Reply with only the word PONG", directory: "/tmp" },
    });
    const text = resultText(result);

    // Header line
    expect(text).toMatch(/^Session: ses_\w+/m);
    expect(text).toMatch(/^Model: \S+\/\S+/m);
    // Agent responded with something
    expect(text.split("\n").slice(2).join("\n").trim()).toBeTruthy();
  });
});

describe("fire + check", () => {
  test("fire returns session ID and check returns a non-empty reply", async () => {
    const fireResult = await client.callTool({
      name: "fire",
      arguments: { prompt: "Reply with only the word ASYNC_OK", directory: "/tmp" },
    });
    const fireText = resultText(fireResult);

    expect(fireText).toMatch(/^Fired\. Session ID: ses_\w+/m);
    expect(fireText).toContain("Use 'check'");

    // Extract the session ID from the fire output
    const match = fireText.match(/Session ID: (ses_\w+)/);
    expect(match).not.toBeNull();
    const sessionID = match![1];

    const checkResult = await client.callTool({
      name: "check",
      arguments: { session_id: sessionID, directory: "/tmp" },
    });
    const checkText = resultText(checkResult);

    expect(checkText).toBeTruthy();
    expect(checkText).not.toBe("(no response)");
  });
});

describe("messages", () => {
  test("returns [USER] and [ASSISTANT] blocks after a completed session", async () => {
    // Use run to create a session with a known exchange
    const runResult = await client.callTool({
      name: "run",
      arguments: { prompt: "Reply with only the word MSGS_OK", directory: "/tmp" },
    });
    const sessionID = resultText(runResult).match(/Session: (ses_\w+)/)?.[1];
    expect(sessionID).toBeTruthy();

    const result = await client.callTool({
      name: "messages",
      arguments: { session_id: sessionID!, directory: "/tmp" },
    });
    const text = resultText(result);

    expect(text).toContain("[USER]");
    expect(text).toContain("[ASSISTANT]");
    expect(text).toContain("---");
  });
});

describe("context_pct", () => {
  test("returns a token estimate and percentage for a session", async () => {
    const runResult = await client.callTool({
      name: "run",
      arguments: { prompt: "Say: CTX_OK", directory: "/tmp" },
    });
    const sessionID = resultText(runResult).match(/Session: (ses_\w+)/)?.[1];
    expect(sessionID).toBeTruthy();

    const result = await client.callTool({
      name: "context_pct",
      arguments: { session_id: sessionID!, directory: "/tmp" },
    });
    const text = resultText(result);

    expect(text).toMatch(/~[\d,]+ tokens estimated/);
    expect(text).toMatch(/\d+% of \d+k limit/);
    expect(text).toMatch(/Safe to reuse|Context high/);
  });
});

describe("reply + check", () => {
  test("reply sends a follow-up and check collects the result", async () => {
    // Create a session with an initial message
    const runResult = await client.callTool({
      name: "run",
      arguments: { prompt: "Say: FIRST_OK", directory: "/tmp" },
    });
    const sessionID = resultText(runResult).match(/Session: (ses_\w+)/)?.[1];
    expect(sessionID).toBeTruthy();

    const replyResult = await client.callTool({
      name: "reply",
      arguments: { session_id: sessionID!, prompt: "Now say: SECOND_OK", directory: "/tmp" },
    });
    const replyText = resultText(replyResult);

    expect(replyText).toContain(`Session ID: ${sessionID}`);
    expect(replyText).toContain("Use 'check'");

    const checkResult = await client.callTool({
      name: "check",
      arguments: { session_id: sessionID!, directory: "/tmp" },
    });
    expect(resultText(checkResult)).toBeTruthy();
  });
});

describe("session_status", () => {
  test("returns formatted metadata for a session", async () => {
    const runResult = await client.callTool({
      name: "run",
      arguments: { prompt: "Say: STATUS_OK", directory: "/tmp" },
    });
    const sessionID = resultText(runResult).match(/Session: (ses_\w+)/)?.[1];
    expect(sessionID).toBeTruthy();

    const result = await client.callTool({
      name: "session_status",
      arguments: { session_id: sessionID! },
    });
    const text = resultText(result);

    expect(text).toMatch(new RegExp(`^Session: ${sessionID}`, "m"));
    expect(text).toMatch(/^Title:\s+/m);
    expect(text).toMatch(/^Model:\s+\S+\/\S+/m);
    expect(text).toMatch(/^Created:/m);
  });
});

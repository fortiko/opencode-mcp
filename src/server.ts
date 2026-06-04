import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  api,
  extractText,
  createSession,
  sendPrompt,
  sendPromptAsync,
  waitForSession,
  getMessages,
  lastAssistantText,
  listProviders,
  listSessions,
  getSession,
} from "./api.js";
import type { operations } from "./openapi.js";

export const server = new Server(
  { name: "opencode-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "run",
      description:
        "Create an OpenCode agent session, send a prompt, wait for completion, and return the full response. Use this for coding tasks delegated to a subagent.",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: { type: "string", description: "The task/prompt to send to the agent" },
          directory: { type: "string", description: "Absolute path to the project directory the agent should work in" },
          title: { type: "string", description: "Optional session title" },
          provider_id: { type: "string", description: `Provider ID (default: ${DEFAULT_PROVIDER})` },
          model_id: { type: "string", description: `Model ID (default: ${DEFAULT_MODEL})` },
        },
        required: ["prompt", "directory"],
      },
    },
    {
      name: "fire",
      description:
        "Create an OpenCode agent session and send a prompt without waiting for completion. Returns the session ID so you can check it later with 'check'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: { type: "string", description: "The task/prompt to send to the agent" },
          directory: { type: "string", description: "Absolute path to the project directory" },
          title: { type: "string", description: "Optional session title" },
          provider_id: { type: "string", description: `Provider ID (default: ${DEFAULT_PROVIDER})` },
          model_id: { type: "string", description: `Model ID (default: ${DEFAULT_MODEL})` },
        },
        required: ["prompt", "directory"],
      },
    },
    {
      name: "check",
      description:
        "Wait for a session to finish and return its final assistant response. Use after 'fire' to collect results.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID returned by 'fire'" },
          directory: { type: "string", description: "Absolute path to the project directory" },
        },
        required: ["session_id", "directory"],
      },
    },
    {
      name: "messages",
      description:
        "Get all messages from an OpenCode session. Useful for reviewing what a subagent did after it completed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID" },
          directory: { type: "string", description: "Absolute path to the project directory" },
        },
        required: ["session_id", "directory"],
      },
    },
    {
      name: "list_models",
      description: "List all available providers and their models, including free models.",
      inputSchema: {
        type: "object" as const,
        properties: {
          directory: { type: "string", description: "Optional project directory for context" },
        },
        required: [],
      },
    },
    {
      name: "reply",
      description:
        "Send a follow-up prompt to an existing session without creating a new one. Use this to continue work in a session whose context is below 55%. Returns the session ID for use with 'check'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Existing session ID to continue" },
          prompt: { type: "string", description: "The follow-up task/prompt" },
          directory: { type: "string", description: "Absolute path to the project directory" },
          provider_id: { type: "string", description: `Provider ID (default: ${DEFAULT_PROVIDER})` },
          model_id: { type: "string", description: `Model ID (default: ${DEFAULT_MODEL})` },
        },
        required: ["session_id", "prompt", "directory"],
      },
    },
    {
      name: "context_pct",
      description:
        "Get the approximate context window usage percentage for a session by counting message tokens. Use this before deciding whether to reuse a session or create a new one.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID to check" },
          directory: { type: "string", description: "Absolute path to the project directory" },
        },
        required: ["session_id", "directory"],
      },
    },
    {
      name: "list_sessions",
      description: "List recent OpenCode sessions, optionally filtered by directory. Use this to find session IDs for sessions that were already fired.",
      inputSchema: {
        type: "object" as const,
        properties: {
          directory: { type: "string", description: "Filter sessions by project directory" },
          limit: { type: "number", description: "Max number of sessions to return (default 20)" },
        },
        required: [],
      },
    },
    {
      name: "session_status",
      description: "Get metadata for an OpenCode session: title, model, agent, directory, token usage, and timestamps. To wait for completion and get the response, use 'check' instead.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: { type: "string", description: "Session ID" },
        },
        required: ["session_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, string>;

  try {
    if (name === "run") {
      const providerID = a.provider_id ?? DEFAULT_PROVIDER;
      const modelID = a.model_id ?? DEFAULT_MODEL;
      const title = a.title ?? `Agent task — ${new Date().toISOString()}`;

      const sessionID = await createSession(a.directory, title, providerID, modelID);
      const response = await sendPrompt(sessionID, a.directory, a.prompt, providerID, modelID);
      const text = extractText(response.parts);

      return {
        content: [
          {
            type: "text",
            text: `Session: ${sessionID}\nModel: ${providerID}/${modelID}\n\n${text || "(no text response — agent may have only written files)"}`,
          },
        ],
      };
    }

    if (name === "fire") {
      const providerID = a.provider_id ?? DEFAULT_PROVIDER;
      const modelID = a.model_id ?? DEFAULT_MODEL;
      const title = a.title ?? `Agent task — ${new Date().toISOString()}`;

      const sessionID = await createSession(a.directory, title, providerID, modelID);
      await sendPromptAsync(sessionID, a.directory, a.prompt, providerID, modelID);

      return {
        content: [
          {
            type: "text",
            text: `Fired. Session ID: ${sessionID}\nModel: ${providerID}/${modelID}\n\nUse 'check' with session_id="${sessionID}" and directory="${a.directory}" to collect the result when done.`,
          },
        ],
      };
    }

    if (name === "check") {
      await waitForSession(a.session_id, a.directory);
      const messages = await getMessages(a.session_id, a.directory);
      const text = lastAssistantText(messages);

      return {
        content: [{ type: "text", text }],
      };
    }

    if (name === "messages") {
      const messages = await getMessages(a.session_id, a.directory);
      const formatted = messages
        .map((m) => {
          const role = m.info.role.toUpperCase();
          const text = extractText(m.parts);
          return `[${role}]\n${text}`;
        })
        .filter((s) => s.trim().length > 0)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: formatted || "(no messages)" }],
      };
    }

    if (name === "list_models") {
      const result = await listProviders();

      const lines: string[] = ["Connected providers:"];
      for (const provider of result.all) {
        if (!result.connected.includes(provider.id)) continue;
        lines.push(`\n## ${provider.name} (${provider.id})`);
        for (const [modelID, model] of Object.entries(provider.models)) {
          lines.push(`  - ${modelID}${model.name ? ` — ${model.name}` : ""}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    if (name === "reply") {
      const providerID = a.provider_id ?? DEFAULT_PROVIDER;
      const modelID = a.model_id ?? DEFAULT_MODEL;
      await sendPromptAsync(a.session_id, a.directory, a.prompt, providerID, modelID);
      return {
        content: [{ type: "text", text: `Replied to session ${a.session_id}.\nSession ID: ${a.session_id}\n\nUse 'check' with session_id="${a.session_id}" and directory="${a.directory}" to collect the result when done.` }],
      };
    }

    if (name === "context_pct") {
      const messages = await getMessages(a.session_id, a.directory);
      // Rough token estimate: count all text chars / 4
      const totalChars = messages.reduce((sum, m) => {
        return sum + extractText(m.parts).length + 10;
      }, 0);
      const estimatedTokens = Math.round(totalChars / 4);
      // Most models have ~200k context; flag > 55% = ~110k tokens
      const contextLimit = 200_000;
      const pct = Math.round((estimatedTokens / contextLimit) * 100);
      const reusable = pct < 55;
      return {
        content: [{
          type: "text",
          text: `Session ${a.session_id}: ~${estimatedTokens.toLocaleString()} tokens estimated (${pct}% of ${(contextLimit / 1000).toFixed(0)}k limit)\n${reusable ? "✅ Safe to reuse (<55%)" : "⚠️  Context high (≥55%) — consider a new session"}`,
        }],
      };
    }

    if (name === "list_sessions") {
      const result = await listSessions({
        directory: a.directory,
        limit: a.limit ? Number(a.limit) : undefined,
      });
      const sessions = result.data ?? result.items ?? [];

      const lines = (sessions as Array<{ id: string; title?: string; directory?: string; path?: string }>).map((s) =>
        `${s.id} | ${s.title ?? "(untitled)"} | ${s.directory ?? s.path ?? ""}`
      );

      return {
        content: [{ type: "text", text: lines.join("\n") || "(no sessions)" }],
      };
    }

    if (name === "session_status") {
      const session = await getSession(a.session_id);

      const lines = [
        `Session: ${session.id}`,
        `Title:   ${session.title ?? "(untitled)"}`,
        `Agent:   ${session.agent ?? "—"}`,
        `Model:   ${session.model ? `${session.model.providerID}/${session.model.id}` : "—"}`,
        `Dir:     ${session.directory ?? "—"}`,
      ];
      if (session.summary) {
        lines.push(`Changes: +${session.summary.additions} -${session.summary.deletions} (${session.summary.files} files)`);
      }
      if (session.time) {
        lines.push(`Created: ${new Date(session.time.created).toISOString()}`);
        lines.push(`Updated: ${new Date(session.time.updated).toISOString()}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

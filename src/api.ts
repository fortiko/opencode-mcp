import type { components, operations } from "./openapi.js";

export const BASE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
export const DEFAULT_PROVIDER = process.env.OPENCODE_DEFAULT_PROVIDER ?? "opencode";
export const DEFAULT_MODEL = process.env.OPENCODE_DEFAULT_MODEL ?? "big-pickle";
export const API_KEY = process.env.OPENCODE_API_KEY ?? "";

// Spec-derived types — regenerate with `npm run generate` when OpenCode updates its API
export type Session = components["schemas"]["Session"];
export type Part = components["schemas"]["Part"];
export type MessageWithParts = operations["session.prompt"]["responses"]["200"]["content"]["application/json"];
export type MessagesResponse = operations["session.messages"]["responses"]["200"]["content"]["application/json"];
export type ProvidersResponse = operations["provider.list"]["responses"]["200"]["content"]["application/json"];
export type SessionsPageResponse = operations["v2.session.list"]["responses"]["200"]["content"]["application/json"] & { items?: unknown[] };

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenCode API ${method} ${path} → ${res.status}: ${text}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export async function createSession(
  directory: string,
  title: string,
  providerID: string,
  modelID: string
): Promise<string> {
  const session = await api<Session>(
    "POST",
    "/session",
    { title, model: { id: modelID, providerID } },
    { directory }
  );
  return session.id;
}

export async function sendPrompt(
  sessionID: string,
  directory: string,
  text: string,
  providerID: string,
  modelID: string
): Promise<MessageWithParts> {
  return api<MessageWithParts>(
    "POST",
    `/session/${sessionID}/message`,
    { parts: [{ type: "text", text }], model: { providerID, modelID } },
    { directory }
  );
}

export async function waitForSession(
  sessionID: string,
  directory: string
): Promise<void> {
  // The wait endpoint lives under /api/ (not /session/), which serves the frontend at /session/*
  await api("POST", `/api/session/${sessionID}/wait`, undefined, { directory });
}

export async function getMessages(
  sessionID: string,
  directory: string
): Promise<MessagesResponse> {
  return api<MessagesResponse>(
    "GET",
    `/session/${sessionID}/message`,
    undefined,
    { directory }
  );
}

export async function sendPromptAsync(
  sessionID: string,
  directory: string,
  text: string,
  providerID: string,
  modelID: string
): Promise<void> {
  await api(
    "POST",
    `/session/${sessionID}/prompt_async`,
    { parts: [{ type: "text", text }], model: { providerID, modelID } },
    { directory }
  );
}

export function lastAssistantText(messages: MessagesResponse): string {
  const assistantMessages = messages.filter((m) => m.info.role === "assistant");
  if (assistantMessages.length === 0) return "(no response)";
  const last = assistantMessages[assistantMessages.length - 1];
  // Narrow to AssistantMessage to access the error field
  if (last.info.role === "assistant" && last.info.error) {
    const err = last.info.error as { message?: string };
    return `Error: ${err.message ?? JSON.stringify(last.info.error)}`;
  }
  return extractText(last.parts) || "(empty response)";
}

export async function listProviders(): Promise<ProvidersResponse> {
  return api<ProvidersResponse>("GET", "/provider");
}

export async function listSessions(opts?: { directory?: string; limit?: number }): Promise<SessionsPageResponse> {
  const query: Record<string, string> = {};
  if (opts?.directory) query.directory = opts.directory;
  if (opts?.limit) query.limit = String(opts.limit);
  // /api/session (paginated) is distinct from /session (array, frontend-facing)
  // The spec defines the field as `data`; v1.14.48 runtime returns `items` — handle both.
  return api<SessionsPageResponse>("GET", "/api/session", undefined, query);
}

export async function getSession(sessionID: string): Promise<Session> {
  return api<Session>("GET", `/session/${sessionID}`);
}

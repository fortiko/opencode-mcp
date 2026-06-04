export const BASE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
export const DEFAULT_PROVIDER = process.env.OPENCODE_DEFAULT_PROVIDER ?? "opencode";
export const DEFAULT_MODEL = process.env.OPENCODE_DEFAULT_MODEL ?? "big-pickle";
export const API_KEY = process.env.OPENCODE_API_KEY ?? "";
export async function api(method, path, body, query) {
    const url = new URL(BASE_URL + path);
    if (query) {
        for (const [k, v] of Object.entries(query))
            url.searchParams.set(k, v);
    }
    const headers = {};
    if (body)
        headers["Content-Type"] = "application/json";
    if (API_KEY)
        headers["Authorization"] = `Bearer ${API_KEY}`;
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
    return (text ? JSON.parse(text) : null);
}
export function extractText(parts) {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
}
export async function createSession(directory, title, providerID, modelID) {
    const session = await api("POST", "/session", { title, model: { id: modelID, providerID } }, { directory });
    return session.id;
}
export async function sendPrompt(sessionID, directory, text, providerID, modelID) {
    return api("POST", `/session/${sessionID}/message`, { parts: [{ type: "text", text }], model: { providerID, modelID } }, { directory });
}
export async function waitForSession(sessionID, directory) {
    // The wait endpoint lives under /api/ (not /session/), which serves the frontend at /session/*
    await api("POST", `/api/session/${sessionID}/wait`, undefined, { directory });
}
export async function getMessages(sessionID, directory) {
    return api("GET", `/session/${sessionID}/message`, undefined, { directory });
}
export async function sendPromptAsync(sessionID, directory, text, providerID, modelID) {
    await api("POST", `/session/${sessionID}/prompt_async`, { parts: [{ type: "text", text }], model: { providerID, modelID } }, { directory });
}
export function lastAssistantText(messages) {
    const assistantMessages = messages.filter((m) => m.info.role === "assistant");
    if (assistantMessages.length === 0)
        return "(no response)";
    const last = assistantMessages[assistantMessages.length - 1];
    // Narrow to AssistantMessage to access the error field
    if (last.info.role === "assistant" && last.info.error) {
        const err = last.info.error;
        return `Error: ${err.message ?? JSON.stringify(last.info.error)}`;
    }
    return extractText(last.parts) || "(empty response)";
}
export async function listProviders() {
    return api("GET", "/provider");
}
export async function listSessions(opts) {
    const query = {};
    if (opts?.directory)
        query.directory = opts.directory;
    if (opts?.limit)
        query.limit = String(opts.limit);
    // /api/session (paginated) is distinct from /session (array, frontend-facing)
    // The spec defines the field as `data`; v1.14.48 runtime returns `items` — handle both.
    return api("GET", "/api/session", undefined, query);
}
export async function getSession(sessionID) {
    return api("GET", `/session/${sessionID}`);
}

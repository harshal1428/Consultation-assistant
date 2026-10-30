import type { ContextItem, ParseResponse } from "../scene/transformations/types";

export const API_BASE =
  String(import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

export const voiceWebSocketUrl = (): string =>
  `${API_BASE.replace(/^http/i, "ws")}/ws/voice`;

function isParseResponse(value: unknown): value is ParseResponse {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as ParseResponse).instructions)
  );
}

/**
 * Send text (spoken or typed) through the single backend parsing pathway.
 * `context` carries at most the last few applied instructions for follow-up
 * resolution; it is bounded here as well as on the server.
 */
export const parseCommandAPI = async (
  text: string,
  context: ContextItem[] = [],
  source?: "voice" | "typed",
): Promise<ParseResponse> => {
  // Backstop for a network-level stall: the backend already bounds the model
  // call, but the UI must never wait forever for a reply.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/parse-command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        context: context.slice(-4),
        ...(source ? { source } : {}),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new Error(
      controller.signal.aborted
        ? "The parsing service took too long to respond. Please try again."
        : "Could not reach the parsing service. Check that the backend is running on port 8000.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = `Parsing failed (HTTP ${response.status}).`;
    try {
      const errorData = await response.json();
      if (errorData?.detail) detail = errorData.detail;
    } catch {
      /* response body was not JSON */
    }
    throw new Error(detail);
  }

  const data: unknown = await response.json();
  if (!isParseResponse(data)) {
    throw new Error("Parsing service returned an unexpected response shape.");
  }
  return data;
};

/** Lightweight reachability probe for the header status indicator. */
export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${API_BASE}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
};

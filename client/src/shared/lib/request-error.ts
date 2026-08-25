const NETWORK_ERROR_PATTERN = /fetch failed|network|terminated|invalid eof|econn|socket|timed?\s*out|connection/i;

export type RequestErrorKind = "model_not_configured" | "network_error" | "request_failed";

export function classifyRequestError(error: unknown): RequestErrorKind {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";

  if (message.includes("model_not_configured")) return "model_not_configured";
  if (NETWORK_ERROR_PATTERN.test(message)) return "network_error";
  return "request_failed";
}

const NETWORK_ERROR_PATTERN = /fetch failed|network|terminated|invalid eof|econn|socket|timed?\s*out|connection/i;

export type RequestErrorKind = "authentication_error" | "model_not_configured" | "network_error" | "permission_error" | "provider_error" | "rate_limit" | "request_failed";

export function classifyRequestError(error: unknown): RequestErrorKind {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";

  if (message.includes("model_not_configured")) return "model_not_configured";
  if (message.includes("provider_http_401")) return "authentication_error";
  if (message.includes("provider_http_403")) return "permission_error";
  if (message.includes("provider_http_429")) return "rate_limit";
  if (message.includes("provider_http_")) return "provider_error";
  if (NETWORK_ERROR_PATTERN.test(message)) return "network_error";
  return "request_failed";
}

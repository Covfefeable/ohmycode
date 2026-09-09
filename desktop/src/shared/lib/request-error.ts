export type RequestErrorKind = "authentication_error" | "model_not_configured" | "network_error" | "permission_error" | "provider_error" | "rate_limit" | "request_failed";

type SerializedRequestError = {
  code: string;
  category: "authentication" | "network" | "permission" | "provider" | "rate_limit" | "request" | "validation";
};

const API_ERROR_PREFIX = "OHMYCODE_API_ERROR:";

export function requestErrorDetails(error: unknown): SerializedRequestError | null {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const marker = message.indexOf(API_ERROR_PREFIX);
  if (marker < 0) return null;
  try {
    return JSON.parse(message.slice(marker + API_ERROR_PREFIX.length)) as SerializedRequestError;
  } catch {
    return null;
  }
}

export function classifyRequestError(error: unknown): RequestErrorKind {
  const details = requestErrorDetails(error);
  if (!details) return "request_failed";
  if (details.code === "model_not_configured") return "model_not_configured";
  if (details.category === "authentication") return "authentication_error";
  if (details.category === "permission") return "permission_error";
  if (details.category === "rate_limit") return "rate_limit";
  if (details.category === "provider") return "provider_error";
  if (details.category === "network") return "network_error";
  return "request_failed";
}

export const API_URL = process.env.OHMYCODE_API_URL ?? "http://ai.llmol.com:8765";

export function isLocalApiUrl(value = API_URL): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

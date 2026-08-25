import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

const DEFAULT_API_URL = process.env.OHMYCODE_API_URL ?? "http://ai.llmol.com:8765";
let apiUrl: string | null = null;

function configPath(): string {
  return path.join(app.getPath("userData"), "debug-config.json");
}

function normalizeApiUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid_api_url");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("invalid_api_url");
  return normalized;
}

export function getApiUrl(): string {
  if (apiUrl) return apiUrl;
  try {
    const stored = JSON.parse(readFileSync(configPath(), "utf8")) as { apiUrl?: unknown };
    apiUrl = typeof stored.apiUrl === "string" ? normalizeApiUrl(stored.apiUrl) : normalizeApiUrl(DEFAULT_API_URL);
  } catch {
    apiUrl = normalizeApiUrl(DEFAULT_API_URL);
  }
  return apiUrl;
}

export function setApiUrl(value: string): string {
  const normalized = normalizeApiUrl(value);
  writeFileSync(configPath(), JSON.stringify({ apiUrl: normalized }, null, 2), "utf8");
  apiUrl = normalized;
  return normalized;
}

export function isLocalApiUrl(value = getApiUrl()): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

import type { WebContents } from "electron";
import { redactUrl, SENSITIVE_FIELD } from "./diagnostic-format.js";

const CAPACITY = 200;
type Headers = Record<string, string | number>;
type Response = { url: string; status: number; mimeType: string; headers: Headers };
type RequestEvent = { requestId: string; timestamp: number; wallTime: number; type?: string; request: { url: string; method: string; headers: Headers }; redirectResponse?: Response };
type RequestRecord = {
  id: string; requestId: string; started: number; timestamp: string; url: string; method: string; type: string;
  state: "pending" | "completed" | "failed"; status?: number; mimeType?: string; durationMs?: number;
  error?: string; blockedReason?: string; corsError?: string; requestHeaders: Headers; responseHeaders?: Headers;
};

function redactHeaders(headers: Headers): Headers {
  return Object.fromEntries(Object.entries(headers).slice(0, 50).map(([name, value]) => [name, SENSITIVE_FIELD.test(name) || /^(referer|location)$/i.test(name) ? "[REDACTED]" : String(value).slice(0, 2000)]));
}

/** Page-scoped metadata only. Chromium retains a bounded body cache for explicit reads. */
export class NetworkDiagnostics {
  private readonly records = new Map<string, RequestRecord>();
  private readonly current = new Map<string, RequestRecord>();

  constructor(private readonly page: WebContents) {}

  async initialize(): Promise<void> {
    await this.page.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 8 * 1024 * 1024, maxResourceBufferSize: 256 * 1024, maxPostDataSize: 0 });
  }

  handle(method: string, params: unknown): void {
    if (method === "Network.requestWillBeSent") {
      const event = params as RequestEvent;
      if (!/^https?:\/\//i.test(event.request.url)) return;
      const previous = this.current.get(event.requestId);
      if (previous && event.redirectResponse) {
        this.respond(previous, event.redirectResponse);
        this.finish(previous, event.timestamp);
      }
      const record: RequestRecord = {
        id: crypto.randomUUID(), requestId: event.requestId, started: event.timestamp,
        timestamp: new Date(event.wallTime * 1000).toISOString(), url: redactUrl(event.request.url),
        method: event.request.method, type: event.type ?? "Other", state: "pending", requestHeaders: redactHeaders(event.request.headers),
      };
      this.records.set(record.id, record);
      this.current.set(event.requestId, record);
      if (this.records.size > CAPACITY) {
        const oldest = this.records.values().next().value!;
        this.records.delete(oldest.id);
        if (this.current.get(oldest.requestId) === oldest) this.current.delete(oldest.requestId);
      }
      return;
    }
    const event = params as { requestId: string; timestamp: number; response: Response; errorText: string; blockedReason?: string; corsErrorStatus?: { corsError: string } };
    const record = this.current.get(event.requestId);
    if (!record) return;
    if (method === "Network.responseReceived") this.respond(record, event.response);
    else if (method === "Network.loadingFinished") this.finish(record, event.timestamp);
    else if (method === "Network.loadingFailed") {
      this.finish(record, event.timestamp);
      record.state = "failed";
      record.error = event.errorText;
      record.blockedReason = event.blockedReason;
      record.corsError = event.corsErrorStatus?.corsError;
    }
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    if (args.action === "list") {
      const limit = args.limit ?? 20;
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error("browser_invalid_limit");
      const matches = [...this.records.values()].filter((record) =>
        (!args.url || record.url.includes(String(args.url))) &&
        (!args.type || record.type.toLowerCase() === String(args.type).toLowerCase()) &&
        (!args.failedOnly || record.state === "failed" || (record.status ?? 0) >= 400));
      return { requests: matches.slice(-Number(limit)).map(({ id, timestamp, url, method, type, state, status, durationMs, error, blockedReason, corsError }) => ({ id, timestamp, url, method, type, state, status, durationMs, error, blockedReason, corsError })), total: matches.length, truncated: matches.length > Number(limit), capacity: CAPACITY };
    }
    const record = this.records.get(String(args.requestId));
    if (!record) throw new Error("browser_request_not_found: request belongs to another tab or was evicted");
    if (args.action === "detail") {
      const detail: Partial<RequestRecord> = { ...record };
      delete detail.requestId;
      delete detail.started;
      return detail;
    }
    if (args.action !== "body") throw new Error("browser_invalid_network_action");
    if (record.state !== "completed") return { available: false, reason: "request_not_completed" };
    if (this.current.get(record.requestId) !== record) return { available: false, reason: "redirect_body_unavailable" };
    if (!/^(text\/)|json|javascript|xml|x-www-form-urlencoded/i.test(record.mimeType ?? "")) return { available: false, reason: "non_text_response" };
    let response: { body: string; base64Encoded: boolean };
    try { response = await this.page.debugger.sendCommand("Network.getResponseBody", { requestId: record.requestId }); }
    catch { return { available: false, reason: "body_not_retained", message: "Chromium no longer retains this response body; it may exceed the buffer limit or predate navigation." }; }
    const body = response.base64Encoded ? Buffer.from(response.body, "base64").toString("utf8") : response.body;
    return { available: true, body: body.slice(0, 32_000), truncated: body.length > 32_000, totalCharacters: body.length };
  }

  private respond(record: RequestRecord, response: Response): void {
    record.status = response.status;
    record.mimeType = response.mimeType;
    record.responseHeaders = redactHeaders(response.headers);
  }

  private finish(record: RequestRecord, timestamp: number): void {
    record.state = "completed";
    record.durationMs = Math.round((timestamp - record.started) * 1000);
  }
}

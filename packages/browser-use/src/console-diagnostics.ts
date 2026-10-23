import { redactUrl } from "./diagnostic-format.js";

const CAPACITY = 500;
type RemoteValue = { type: string; value?: string | number | boolean | null; unserializableValue?: string; description?: string; preview?: { description?: string; properties: { name: string; value?: string; type: string }[]; overflow: boolean } };
type Source = { url: string; lineNumber: number; columnNumber: number };
type ConsoleEntry = { sequence: number; timestamp: string; level: string; kind: "console" | "exception"; text: string; url?: string; line?: number; column?: number };

const clip = (value: string, limit = 2000) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

function summarize(value: RemoteValue): string {
  if (value.value !== undefined) return clip(String(value.value));
  if (value.unserializableValue) return value.unserializableValue;
  if (value.preview) {
    const properties = value.preview.properties.slice(0, 10).map((property) => `${property.name.slice(0, 100)}: ${(property.value ?? property.type).slice(0, 200)}`);
    return clip(`${value.preview.description ?? value.type} { ${properties.join(", ")}${value.preview.overflow || value.preview.properties.length > 10 ? ", …" : ""} }`);
  }
  return clip(value.description ?? value.type);
}

/** Bounded value previews, never property traversal or getter execution. */
export class ConsoleDiagnostics {
  private sequence = 0;
  private readonly entries: ConsoleEntry[] = [];

  handle(method: string, params: unknown): void {
    if (method === "Runtime.consoleAPICalled") {
      const event = params as { type: string; timestamp: number; args: RemoteValue[]; stackTrace?: { callFrames: Source[] } };
      const level = event.type === "warning" ? "warning" : ["error", "assert"].includes(event.type) ? "error" : ["debug", "info"].includes(event.type) ? event.type : "log";
      this.add({ level, kind: "console", text: event.args.slice(0, 20).map(summarize).join(" ").slice(0, 4000) || event.type, timestamp: new Date(event.timestamp).toISOString() }, event.stackTrace?.callFrames[0]);
    } else if (method === "Runtime.exceptionThrown") {
      const event = params as { timestamp: number; exceptionDetails: Source & { text: string; exception?: RemoteValue; stackTrace?: { callFrames: Source[] } } };
      const details = event.exceptionDetails;
      this.add({ level: "error", kind: "exception", text: (details.exception ? summarize(details.exception) : details.text).slice(0, 4000), timestamp: new Date(event.timestamp).toISOString() }, details.stackTrace?.callFrames[0] ?? details);
    }
  }

  read(args: Record<string, unknown>): unknown {
    const after = args.after ?? 0;
    const limit = args.limit ?? 50;
    if (!Number.isInteger(after) || Number(after) < 0) throw new Error("browser_invalid_console_cursor");
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error("browser_invalid_limit");
    const matches = this.entries.filter((entry) => entry.sequence > Number(after) && (!args.level || entry.level === args.level));
    const entries = matches.slice(0, Number(limit));
    const hasMore = matches.length > entries.length;
    return { entries, nextCursor: hasMore ? entries.at(-1)!.sequence : this.sequence, hasMore, dropped: Number(after) < (this.entries[0]?.sequence ?? 1) - 1, capacity: CAPACITY };
  }

  private add(entry: Omit<ConsoleEntry, "sequence">, source?: Source): void {
    this.entries.push({ ...entry, sequence: ++this.sequence, ...(source ? {
      url: /^https?:\/\//i.test(source.url) ? redactUrl(source.url) : source.url?.slice(0, 4000),
      line: source.lineNumber + 1, column: source.columnNumber + 1,
    } : {}) });
    if (this.entries.length > CAPACITY) this.entries.shift();
  }
}

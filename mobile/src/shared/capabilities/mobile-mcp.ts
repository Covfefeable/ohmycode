import { Client } from "@modelcontextprotocol/sdk/client";
import { createMcpToolName, matchesMcpServer, mcpToolServerToken } from "@ohmycode/tool-contracts";
import { fetch as expoFetch } from "expo/fetch";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { authenticatedRequest } from "@/shared/api/api-client";

import { ensureEventGlobals } from "./event-globals";
import type { McpServer } from "./types";

type Session = { client: Client; server: McpServer };

type CompatibleAbortSignal = AbortSignal & { throwIfAborted: () => void };

const mobileMcpFetch: typeof globalThis.fetch = (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  return expoFetch(url, init as Parameters<typeof expoFetch>[1]);
};

function compatibleAbortSignal(signal?: AbortSignal): CompatibleAbortSignal | undefined {
  if (!signal) return undefined;
  const candidate = signal as CompatibleAbortSignal;
  if (typeof candidate.throwIfAborted === "function") return candidate;
  return new Proxy(candidate, {
    get(target, property) {
      if (property === "throwIfAborted") {
        return () => {
          if (!target.aborted) return;
          if (target.reason !== undefined) throw target.reason;
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class MobileMcpClient {
  private readonly sessions = new Map<string, Session>();
  private readonly connections = new Map<string, Promise<Client>>();

  private async servers(signal?: AbortSignal): Promise<McpServer[]> {
    const result = await authenticatedRequest<{ servers: McpServer[] }>(
      "/api/capabilities/mcp/runtime",
      { signal },
    );
    return result.servers.filter((server) => server.transport === "http");
  }

  private async connect(server: McpServer, signal?: AbortSignal): Promise<Client> {
    const existing = this.connections.get(server.id);
    if (existing) return existing;
    const connection = this.open(server, signal);
    this.connections.set(server.id, connection);
    try {
      return await connection;
    } finally {
      if (this.connections.get(server.id) === connection) this.connections.delete(server.id);
    }
  }

  private async open(server: McpServer, signal?: AbortSignal): Promise<Client> {
    const url = new URL(server.configuration.url || "");
    const client = new Client({ name: "ohmycode-mobile", version: "0.1.0" }, { capabilities: {} });
    let transport;
    if (/\/sse\/?$/i.test(url.pathname)) {
      ensureEventGlobals();
      // Expo's resolver does not understand the SDK's wildcard exports. Keep
      // SSE lazy so its EventSource dependency sees the React Native globals.
      // eslint-disable-next-line import/no-unresolved
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      transport = new SSEClientTransport(url, {
        fetch: mobileMcpFetch,
        requestInit: { headers: server.configuration.headers },
        eventSourceInit: { fetch: mobileMcpFetch },
      });
    } else {
      transport = new StreamableHTTPClientTransport(url, {
        fetch: mobileMcpFetch,
        requestInit: { headers: server.configuration.headers },
      });
    }
    await client.connect(transport, { signal: compatibleAbortSignal(signal) });
    this.sessions.set(server.id, { client, server });
    client.onclose = () => {
      if (this.sessions.get(server.id)?.client === client) this.sessions.delete(server.id);
    };
    return client;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const serverToken = mcpToolServerToken(toolName);
    if (!serverToken) throw new Error("invalid_mcp_tool");
    const server = (await this.servers(signal)).find((item) => matchesMcpServer(item.id, serverToken));
    if (!server) throw new Error("capability_unavailable_on_mobile");
    const originalName = server.tools.find((tool) => createMcpToolName(server.id, tool.name) === toolName)?.name;
    if (!originalName) throw new Error("mcp_tool_not_found");
    let session = this.sessions.get(server.id);
    if (!session) session = { client: await this.connect(server, signal), server };
    try {
      return await session.client.callTool(
        { name: originalName, arguments: args },
        undefined,
        { signal: compatibleAbortSignal(signal) },
      );
    } catch {
      if (signal?.aborted) {
        if (signal.reason instanceof Error) throw signal.reason;
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      this.sessions.delete(server.id);
      await session.client.close().catch(() => undefined);
      const client = await this.connect(server, signal);
      return client.callTool(
        { name: originalName, arguments: args },
        undefined,
        { signal: compatibleAbortSignal(signal) },
      );
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.connections.values());
    await Promise.allSettled([...this.sessions.values()].map((session) => session.client.close()));
    this.sessions.clear();
  }
}

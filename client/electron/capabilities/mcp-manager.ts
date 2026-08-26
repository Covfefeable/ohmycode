import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { apiRequest } from "../api/api-client.js";
import type { McpServerInput, McpServerRecord, McpTool } from "./types.js";

type Session = { client: Client; server: McpServerRecord };
const sessions = new Map<string, Session>();

function sessionFetch(): typeof fetch {
  const cookies = new Map<string, string>();
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookies.size) headers.set("cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(input, { ...init, headers });
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
    return response;
  };
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  return (await apiRequest<{ servers: McpServerRecord[] }>("/api/capabilities/mcp")).servers;
}

export function saveMcpServer(input: McpServerInput): Promise<McpServerRecord> {
  return apiRequest(`/api/capabilities/mcp${input.id ? `/${input.id}` : ""}`, {
    method: input.id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await sessions.get(id)?.client.close();
  sessions.delete(id);
  await apiRequest(`/api/capabilities/mcp/${id}`, { method: "DELETE" });
}

async function runtimeServer(id: string): Promise<McpServerRecord> {
  const servers = (await apiRequest<{ servers: McpServerRecord[] }>("/api/capabilities/mcp/runtime")).servers;
  const server = servers.find((item) => item.id === id);
  if (!server) throw new Error("mcp_server_not_found");
  return server;
}

async function connect(server: McpServerRecord): Promise<Client> {
  await sessions.get(server.id)?.client.close();
  const client = new Client({ name: "ohmycode", version: "0.1.0" }, { capabilities: {} });
  const configuration = server.configuration;
  let transport;
  if (server.transport === "stdio") {
    transport = new StdioClientTransport({
        command: configuration.command || "",
        args: configuration.args || [],
        cwd: configuration.cwd || undefined,
        env: configuration.env,
        stderr: "pipe",
      });
  } else {
    const url = new URL(configuration.url || "");
    const fetchWithSession = sessionFetch();
    transport = /\/sse\/?$/i.test(url.pathname)
      ? new SSEClientTransport(url, {
        fetch: fetchWithSession,
        eventSourceInit: { fetch: fetchWithSession },
        requestInit: { headers: configuration.headers },
      })
      : new StreamableHTTPClientTransport(url, {
        requestInit: { headers: configuration.headers },
      });
  }
  await client.connect(transport);
  sessions.set(server.id, { client, server });
  client.onclose = () => {
    if (sessions.get(server.id)?.client === client) sessions.delete(server.id);
  };
  return client;
}

export async function testMcpServer(id: string): Promise<McpServerRecord> {
  try {
    const server = await runtimeServer(id);
    const client = await connect(server);
    const result = await client.listTools();
    const tools: McpTool[] = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    return apiRequest(`/api/capabilities/mcp/${id}/tools`, {
      method: "PUT",
      body: JSON.stringify({ tools }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "mcp_connection_failed";
    await apiRequest(`/api/capabilities/mcp/${id}/tools`, {
      method: "PUT",
      body: JSON.stringify({ tools: [], error: message }),
    }).catch(() => undefined);
    throw error;
  }
}

export async function callMcpTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  let session = sessions.get(serverId);
  if (!session) {
    const server = await runtimeServer(serverId);
    const client = await connect(server);
    session = { client, server };
  }
  try {
    return await session.client.callTool({ name, arguments: args });
  } catch {
    sessions.delete(serverId);
    await session.client.close().catch(() => undefined);
    const client = await connect(await runtimeServer(serverId));
    return client.callTool({ name, arguments: args });
  }
}

export async function callMcpToolByIdentifier(identifier: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const servers = await listMcpServers();
  const server = servers.find((item) => item.identifier === identifier && item.enabled);
  if (!server) throw new Error("mcp_server_not_found");
  return callMcpTool(server.id, name, args);
}

export async function closeMcpSessions(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map((session) => session.client.close()));
  sessions.clear();
}

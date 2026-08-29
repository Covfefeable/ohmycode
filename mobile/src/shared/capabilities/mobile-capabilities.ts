import { unzipSync } from "fflate";
import { createMcpToolName } from "@ohmycode/tool-contracts";

import { authenticatedFetch, authenticatedRequest } from "@/shared/api/api-client";

import type { CapabilitySearchResult, McpServer, SkillRecord } from "./types";

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;

async function inventories(signal?: AbortSignal): Promise<{ servers: McpServer[]; skills: SkillRecord[] }> {
  const [mcp, skill] = await Promise.all([
    authenticatedRequest<{ servers: McpServer[] }>("/api/capabilities/mcp", { signal }),
    authenticatedRequest<{ skills: SkillRecord[] }>("/api/capabilities/skills", { signal }),
  ]);
  return { servers: mcp.servers, skills: skill.skills };
}

export async function searchMobileCapabilities(query: string, signal?: AbortSignal): Promise<unknown> {
  const [search, inventory] = await Promise.all([
    authenticatedRequest<{ results: CapabilitySearchResult[] }>("/api/capabilities/search", {
      method: "POST",
      body: JSON.stringify({ query }),
      signal,
    }),
    inventories(signal),
  ]);
  const supportedMcp = new Set(
    inventory.servers
      .filter((server) => server.enabled && server.transport === "http")
      .map((server) => `mcp:${server.id}`),
  );
  const supportedSkills = new Set(
    inventory.skills.filter((skill) => skill.enabled).map((skill) => `skill:${skill.name}`),
  );
  return {
    results: search.results.filter((result) =>
      result.type === "mcp" ? supportedMcp.has(result.id) : supportedSkills.has(result.id)),
  };
}

function readSkillManifest(archive: Uint8Array): string {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("skill_archive_too_large");
  const entries = unzipSync(archive);
  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  if (!names.length || names.length > MAX_FILES) throw new Error("invalid_skill_archive");
  const normalized = names.map((name) => name.replaceAll("\\", "/"));
  if (normalized.some((name) => name.startsWith("/") || name.split("/").includes(".."))) {
    throw new Error("invalid_skill_archive_path");
  }
  const manifestName = normalized.find((name) => name === "SKILL.md")
    ?? normalized.find((name) => name.endsWith("/SKILL.md"));
  if (!manifestName) throw new Error("skill_manifest_missing");
  const total = names.reduce((sum, name) => sum + entries[name].byteLength, 0);
  if (total > MAX_EXTRACTED_BYTES) throw new Error("skill_extracted_too_large");
  return new TextDecoder().decode(entries[names[normalized.indexOf(manifestName)]]);
}

export async function loadMobileCapability(id: string, signal?: AbortSignal): Promise<unknown> {
  const inventory = await inventories(signal);
  if (id.startsWith("mcp:")) {
    const server = inventory.servers.find((item) =>
      `mcp:${item.id}` === id && item.enabled && item.transport === "http");
    if (!server) throw new Error("capability_unavailable_on_mobile");
    return {
      id,
      type: "mcp",
      name: server.name,
      tools: server.tools.map((tool) => ({
        type: "function",
        function: {
          name: createMcpToolName(server.id, tool.name),
          description: tool.description || `${server.name}: ${tool.name}`,
          parameters: tool.inputSchema || { type: "object", properties: {} },
        },
      })),
    };
  }
  if (id.startsWith("skill:")) {
    const skill = inventory.skills.find((item) =>
      `skill:${item.name}` === id && item.enabled);
    if (!skill) throw new Error("capability_unavailable_on_mobile");
    const response = await authenticatedFetch(
      `/api/capabilities/skills/${skill.id}/archive`,
      { signal },
    );
    const archive = new Uint8Array(await response.arrayBuffer());
    return {
      id,
      type: "skill",
      name: skill.name,
      instructions: readSkillManifest(archive),
    };
  }
  throw new Error("capability_unavailable_on_mobile");
}

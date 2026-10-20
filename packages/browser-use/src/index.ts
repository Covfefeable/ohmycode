import type { ToolPlugin } from "@ohmycode/tool-contracts";
import { BrowserHost } from "./browser-host.js";
import { BROWSER_TOOL_DEFINITIONS } from "./definitions.js";

export { BrowserHost, BROWSER_TOOL_DEFINITIONS };
export type { BrowserState, BrowserTab, BrowserCommand, BrowserBounds } from "./types.js";

export function createBrowserPlugin(host: BrowserHost, conversationId: string, supportsVision: boolean, signal?: AbortSignal): ToolPlugin {
  const definitions = BROWSER_TOOL_DEFINITIONS.filter((tool) => supportsVision || tool.name !== "browser_screenshot");
  const names = new Set(definitions.map((tool) => tool.name));
  return {
    id: "browser",
    definitions: () => definitions,
    handles: (name) => names.has(name),
    execute: async (call) => ({ callId: call.callId, result: await host.execute(conversationId, call.tool, call.arguments as Record<string, unknown>, signal) }),
  };
}

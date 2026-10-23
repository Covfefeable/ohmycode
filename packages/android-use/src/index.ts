import type { ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { AndroidHost } from "./android-host.js";
export { AndroidHost };
export { checkEnvironment, checkAdb, sdkCandidates } from "./environment.js";
export { listDevices, connectDevice, networkAddress } from "./adb.js";
export { installRuntime } from "./install/installer.js";
export { runtimeComponents, SDK_LICENSE_URL, REQUIRED_FREE_BYTES } from "./install/manifest.js";
export { checkVirtualization } from "./install/preflight.js";
export type { AndroidState, AndroidAction, AndroidTouch, AndroidEnvironment, AndroidIssue, AndroidInstallState, AndroidInstallPlan, AndroidInstallMode, AndroidTarget, AndroidDevice } from "./types.js";
export { ensureVideoServer } from "./video/server.js";
export type { AndroidVideoPacket } from "./video/protocol.js";

const definitions: ToolDefinition[] = [
  { name: "android_device", description: "Use only the Android device selected by the user in Settings. You cannot select another device; never bypass this using terminal/ADB commands or restart a shared ADB server. start connects and exclusively locks the selected external device, or boots the selected built-in emulator (up to two minutes). stop releases the connection/lock; only an app-owned emulator is shut down. Always stop when finished. If unavailable/offline/unauthorized, report it; never switch targets or start a fallback automatically. No device-selection parameters are accepted.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["status", "start", "stop"] } }, required: ["action"], additionalProperties: false } },
  { name: "android_snapshot", description: "Read compact Android accessibility nodes: text, description, resourceId, bounds and true state flags; enabled:false marks disabled elements. parentId is the nearest retained ancestor; actionableParentId identifies a clickable, long-clickable, scrollable or focusable ancestor, not a guarantee of successful taps. IDs are snapshot-local references, not action targets. Connect the device selected in Settings first. Bounds reflect current layout, not guaranteed visibility: keyboard/overlays may cover nodes and IME content may be absent. Re-observe after layout changes; never reuse stale coordinates. Prefer resource IDs plus verified labels and an appropriate actionable ancestor, not assumed button roles or fixed parent depth. For resultRef, search_tool_result by text or resourceId rather than reading the whole result or fetching it again. Use a screenshot for uncertain occlusion or input mode.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "android_screenshot", description: "View the current Android screen. Returns an image with its pixel dimensions. Connect the device selected in Settings first.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "android_act", description: "Operate Android using current screen pixel coordinates: tap, swipe (same endpoints plus duration can hold), navigation keys, ASCII text only. Inspect only what the next step needs, not all apps or pages. Verify the expected change, including asynchronous permission dialogs; action/launch success does not prove readiness or persistence. If unchanged, check stale coordinates, keyboard/overlays or loading before retrying; retry only with new evidence or changed conditions. Keyboard language/conversion may persist or change by field. No search match is not proof of absent data. Re-open or re-read saved content; compare matching fields and dates across sources. Report missing required apps/capabilities; do not silently save into unrelated apps or install substitutes. Prefer these tools to raw adb; if shell is needed, account for host-shell and Android-shell quoting separately. Use a bounded wait and targeted state check, not screenshot polling.", inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["tap", "swipe", "text", "key"] }, x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
    endX: { type: "integer", minimum: 0 }, endY: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 1, maximum: 10000 },
    text: { type: "string" }, key: { type: "string", enum: ["back", "home", "recent", "enter", "delete"] },
  }, required: ["action"], additionalProperties: false } },
];

export function createAndroidPlugin(host: AndroidHost, conversationId: string, supportsVision: boolean, signal?: AbortSignal): ToolPlugin {
  const tools = host.available ? definitions.filter((tool) => supportsVision || tool.name !== "android_screenshot") : [];
  const names = new Set(tools.map((tool) => tool.name));
  return {
    id: "android", definitions: () => host.available ? tools : [], handles: (name) => names.has(name),
    async execute(call) {
      if (!names.has(call.tool) || !host.available) throw new Error("android_not_available");
      signal?.throwIfAborted();
      host.assertAccess(conversationId);
      let result: unknown;
      if (call.tool === "android_device") {
        const action = (call.arguments as { action?: string })?.action;
        if (action === "start") await host.start(conversationId, signal);
        else if (action === "stop") await host.stopFor(conversationId);
        else if (action !== "status") throw new Error("android_invalid_action");
        const state = host.state();
        result = { target: state.target, phase: state.phase, enabled: state.enabled, installed: state.installed, error: state.error, ownerConversationId: state.ownerConversationId };
      } else if (call.tool === "android_screenshot") result = await host.screenshot(conversationId, signal);
      else if (call.tool === "android_snapshot") result = await host.snapshot(conversationId, signal);
      else result = await host.act(conversationId, call.arguments, signal);
      return { callId: call.callId, result };
    },
  };
}

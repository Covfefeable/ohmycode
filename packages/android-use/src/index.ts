import type { ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { AndroidHost } from "./android-host.js";
export { AndroidHost };
export { checkEnvironment, checkAdb, sdkCandidates } from "./environment.js";
export { listDevices, connectDevice, networkAddress } from "./adb.js";
export { installRuntime } from "./install/installer.js";
export { runtimeComponents, SDK_LICENSE_URL, REQUIRED_FREE_BYTES } from "./install/manifest.js";
export { checkVirtualization } from "./install/preflight.js";
export type { AndroidState, AndroidAction, AndroidSelector, AndroidTouch, AndroidEnvironment, AndroidIssue, AndroidInstallState, AndroidInstallPlan, AndroidInstallMode, AndroidTarget, AndroidDevice } from "./types.js";
export { ensureVideoServer } from "./video/server.js";
export type { AndroidVideoPacket } from "./video/protocol.js";

const selectorSchema = { type: "object", properties: {
  resourceId: { type: "string" }, text: { type: "string" }, textContains: { type: "string" }, description: { type: "string" }, className: { type: "string" }, packageName: { type: "string" }, focused: { type: "boolean" },
}, minProperties: 1, additionalProperties: false };
const definitions: ToolDefinition[] = [
{ name: "android_device", description: "Use only the device selected in Settings. start connects/boots it, prepares UIAutomator and exclusively locks it to this conversation. Turn completion, failure or cancellation schedules release after 3 minutes; a new turn in the same conversation cancels that timer and reuses the connection. Ownership remains exclusive during the grace period. Explicit stop releases immediately; only the built-in emulator is shut down. Do not select targets via shell or restart shared ADB. Offline/unauthorized requires user action, never auto-fallback.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["status", "start", "stop"] } }, required: ["action"], additionalProperties: false } },
  { name: "android_snapshot", description: "Read a compact live UIAutomator hierarchy with snapshotId, numeric node IDs, resourceId, text, description, class and ancestry, plus screen.width/height/rotation. enabled=false marks disabled nodes; default enabled=true is omitted. editable is included only if explicitly supplied by the device; missing means unknown, never infer it from class names. Checkable nodes always include checked=true/false. Use selectors or snapshotId+nodeId to avoid guessing coordinates. Node IDs are local positions, NOT persistent identities: a new snapshot, action, user input or detected change to the referenced node/ancestry invalidates references. Obtain a fresh snapshot on expiry; use selectors for repeated operations. Bounds use current rotated screen pixels; tree presence does not prove no keyboard/overlay occlusion. Use screenshots only when needed. Large resultRef results should be searched by relevant text/resourceId rather than repeatedly dumped.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "android_screenshot", description: "View the selected device's current screen. Returns screenshotId, image width/height and screen.width/height/rotation. Coordinate actions must reference this screenshotId and explicitly choose image-pixels or normalized-1000; the tool maps them to device pixels. A new screenshot, user input or disconnection invalidates the old reference; geometry changes are rejected. This does not detect all page changes: observe again after navigation, scrolling or overlays move the target. Optional delayMs (0–5000, cancellable) waits before capture on visual-only pages; do not guess inaccessible selectors. Omit delay for immediate capture. No automatic screenshot or success verification follows an action.", inputSchema: { type: "object", properties: { delayMs: { type: "integer", minimum: 0, maximum: 5000, description: "Delay before capture in milliseconds; omit for immediate capture." } }, additionalProperties: false } },
{ name: "android_act", description: "Operate the selected device. tap uses exactly one target: selector, latest snapshotId+nodeId, or x/y with screenshotId+coordinateSpace. Coordinate swipe also requires screenshotId+coordinateSpace; converted device-pixel points are returned for diagnosis, not proof of success. Selectors combine observed attributes with AND; packageName matches exactly. Ambiguity returns candidates with IDs/bounds/parent context; refine rather than choosing the first match. text replaces the targeted Unicode field, or the focused accessible field if omitted. executed means command execution; text/textMatched mean field readback only, not application acceptance or persistence. Inaccessible fields cannot be assumed writable. wait(selector,state=present/absent,timeoutMs) waits internally without screenshots or model polling; presence does not prove visibility or readiness. Use it for an observed expected widget, never a guessed selector. For visual-only pages use android_screenshot with optional delayMs. Reuse a sufficient observation; do not collect both tree and screenshot by default or observe after every trivial action. Refresh when layout or target location changes and verify meaningful outcomes. A timeout calls for diagnosis, not blindly longer waits. Report missing apps; do not substitute unrelated apps/data locations. Keyboard and overlays can obscure targets.", inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["tap", "swipe", "text", "key", "wait"] }, x: { type: "number", minimum: 0 }, y: { type: "number", minimum: 0 },
    endX: { type: "number", minimum: 0 }, endY: { type: "number", minimum: 0 }, durationMs: { type: "integer", minimum: 1, maximum: 10000 },
    screenshotId: { type: "string", description: "Required for coordinate tap/swipe. Use the current android_screenshot ID." },
    coordinateSpace: { type: "string", enum: ["image-pixels", "normalized-1000"], description: "Required for coordinate tap/swipe. image-pixels uses returned image width/height; normalized-1000 maps 0..1000 across the image, including the far edge. Never infer units from the values." },
    text: { type: "string" }, key: { type: "string", enum: ["back", "home", "recent", "enter", "delete"] },
    selector: selectorSchema, snapshotId: { type: "string" }, nodeId: { type: "integer", minimum: 1 },
    state: { type: "string", enum: ["present", "absent"] }, timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
  }, required: ["action"], additionalProperties: false } },
];

export function createAndroidPlugin(host: AndroidHost, conversationId: string, supportsVision: boolean, signal?: AbortSignal): ToolPlugin {
  host.retainFor(conversationId);
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
      } else if (call.tool === "android_screenshot") result = await host.screenshot(conversationId, signal, (call.arguments as { delayMs?: number })?.delayMs);
      else if (call.tool === "android_snapshot") result = await host.snapshot(conversationId, signal);
      else result = await host.act(conversationId, call.arguments, signal, "agent");
      return { callId: call.callId, result };
    },
    close: () => host.releaseFor(conversationId),
  };
}

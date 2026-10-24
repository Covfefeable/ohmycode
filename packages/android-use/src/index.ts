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
{ name: "android_device", description: "Use only the device selected in Settings. start connects/boots it, prepares the pinned UIAutomator service and exclusively locks it to this conversation. Reuse the connection across steps within the current turn. Turn completion, failure or cancellation automatically releases it; call start again in a later turn if needed. stop releases app-owned automation/video; only the built-in emulator is shut down. Do not select targets via shell or restart shared ADB. Offline/unauthorized requires user action, never auto-fallback.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["status", "start", "stop"] } }, required: ["action"], additionalProperties: false } },
  { name: "android_snapshot", description: "Read a compact live UIAutomator hierarchy with snapshotId, numeric node IDs, resourceId, text, description, class and ancestry, plus screen.width/height/rotation. Use selector-based actions or snapshotId+nodeId to avoid guessing coordinates. IDs expire after actions or user touch; obtain a new snapshot if expired. Bounds use the current rotated screen's pixels; tree presence does not prove no keyboard/overlay occlusion. Use screenshots only when needed. Large resultRef results should be searched by relevant text/resourceId rather than repeatedly dumped.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "android_screenshot", description: "View the selected device's current screen. Optional delayMs (0–5000, default 0, cancellable) lets a transition settle before capturing; prefer this for screenshot/coordinate operation on games or canvases without accessible widgets, rather than guessing selectors to wait on. Returns actual screenshot pixel width/height and screen.rotation; tap/swipe coordinates use that same rotated screen-pixel space. Device must be connected. A layout-change error means obtain a fresh observation.", inputSchema: { type: "object", properties: { delayMs: { type: "integer", minimum: 0, maximum: 5000, description: "Delay before capture in milliseconds; omit for immediate capture." } }, additionalProperties: false } },
{ name: "android_act", description: "Operate the connected device through UIAutomator selectors (resourceId/text/textContains/description/className/packageName/focused, combined with AND; packageName is exact, not a prefix) or latest snapshotId+nodeId. tap accepts exactly a selector/node target OR screen-pixel x/y; unique matching is required, ambiguous matches are not guessed. text replaces the selected field with Unicode text; omitted target uses the focused field. Readback reports verification, not persistence. wait uses selector and state=present/absent with timeoutMs: it is a widget condition, NOT sleep or application readiness. Use selectors supported by observations, never infer accessible text from a screenshot or guess package names. timedOut means only the condition was not met, not that the preceding action failed; re-observe and diagnose instead of repeating the same condition with a longer timeout. Presence is not unobstructed visibility. For visual-only games/canvases use screenshots and coordinates, optionally android_screenshot.delayMs for transitions. Coordinate swipe/key remain for gestures/navigation and pages without widgets. Observe only the next needed target; verify changes and saved data, diagnose before retrying. Do not substitute unrelated apps or data locations. Missing apps must be reported. Keyboard/overlays and layout changes can affect operations.", inputSchema: { type: "object", properties: {
    action: { type: "string", enum: ["tap", "swipe", "text", "key", "wait"] }, x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 },
    endX: { type: "integer", minimum: 0 }, endY: { type: "integer", minimum: 0 }, durationMs: { type: "integer", minimum: 1, maximum: 10000 },
    text: { type: "string" }, key: { type: "string", enum: ["back", "home", "recent", "enter", "delete"] },
    selector: selectorSchema, snapshotId: { type: "string" }, nodeId: { type: "integer", minimum: 1 },
    state: { type: "string", enum: ["present", "absent"] }, timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
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
      } else if (call.tool === "android_screenshot") result = await host.screenshot(conversationId, signal, (call.arguments as { delayMs?: number })?.delayMs);
      else if (call.tool === "android_snapshot") result = await host.snapshot(conversationId, signal);
      else result = await host.act(conversationId, call.arguments, signal);
      return { callId: call.callId, result };
    },
    close: () => host.releaseFor(conversationId),
  };
}

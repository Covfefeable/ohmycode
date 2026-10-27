import { randomUUID } from "node:crypto";
import type { OperationPoint, PointerFeedback } from "@ohmycode/tool-contracts";
import { setTimeout as delay } from "node:timers/promises";
import { actionArguments, gestureDuration, screenPoint } from "../command.js";
import { ScreenshotCoordinates } from "../coordinates.js";
import { compactSnapshot } from "../snapshot.js";
import type { AdbTarget, AndroidSelector } from "../types.js";
import { UiAutomatorServer } from "./server.js";
import { matchingNodes, parseSelector, rpcSelector, timeout } from "./selector.js";

type DeviceInfo = { displayWidth: number; displayHeight: number; displayRotation: number };
type NodeInfo = { text: string | null; resourceName: string; className: string; enabled: boolean; bounds: { left: number; top: number; right: number; bottom: number } };
type Snapshot = ReturnType<typeof compactSnapshot> & { snapshotId: string };
const MAX_AMBIGUOUS_CANDIDATES = 10;

function sameReference(previous: Snapshot, current: ReturnType<typeof compactSnapshot>, nodeId: number): boolean {
  if (previous.rotation !== current.rotation) return false;
  let node = previous.nodes.find((item) => item.id === nodeId);
  while (node) {
    const live = current.nodes.find((item) => item.id === node!.id);
    if (JSON.stringify(node) !== JSON.stringify(live)) return false;
    node = node.parentId === undefined ? undefined : previous.nodes.find((item) => item.id === node!.parentId);
  }
  return true;
}

export class AndroidAutomation {
  readonly screenshots = new ScreenshotCoordinates();
  private readonly server: UiAutomatorServer;
  private latest?: Snapshot;
  constructor(target: AdbTarget, root: string, fetcher: typeof fetch = fetch) { this.server = new UiAutomatorServer(target, root, fetcher); }
  get signal(): AbortSignal { return this.server.signal; }
  start(signal?: AbortSignal) { return this.server.start(signal); }
  close() { this.invalidate(); return this.server.close(); }
  invalidate(): void { this.latest = undefined; this.screenshots.invalidate(); }
  async screen(signal?: AbortSignal) {
    const info = await this.server.call<DeviceInfo>("deviceInfo", [], signal);
    return { width: info.displayWidth, height: info.displayHeight, rotation: info.displayRotation, coordinates: "screen-pixels" as const };
  }
  async snapshot(signal?: AbortSignal) {
    this.latest = undefined;
    const xml = await this.server.call<string>("dumpWindowHierarchy", [false], signal);
    const parsed = compactSnapshot(xml);
    const screen = await this.screen(signal);
    if (parsed.rotation !== screen.rotation) throw new Error("android_layout_changed");
    const snapshot = { ...parsed, snapshotId: randomUUID() };
    this.latest = snapshot;
    return { ...snapshot, screen };
  }
  private nodeSelector(args: Record<string, unknown>, action: "tap" | "long_press" | "text"): AndroidSelector {
    if (args.selector !== undefined) {
      if (args.nodeId !== undefined || args.snapshotId !== undefined) throw new Error("android_invalid_selector");
      return parseSelector(args.selector);
    }
    if (args.nodeId === undefined && args.snapshotId === undefined) return { focused: true };
    if (!this.latest || args.snapshotId !== this.latest.snapshotId) throw new Error("android_snapshot_expired");
    const node = this.latest.nodes.find((node) => node.id === args.nodeId);
    if (!node) throw new Error("android_node_not_found");
    let actionable = node;
    const actionableFlag = action === "long_press" ? "long-clickable" : "clickable";
    if (action !== "text" && !node[actionableFlag]) {
      let parent = node.parentId === undefined ? undefined : this.latest.nodes.find((item) => item.id === node.parentId);
      while (parent) {
        if (parent[actionableFlag]) { actionable = parent; break; }
        parent = parent.parentId === undefined ? undefined : this.latest.nodes.find((item) => item.id === parent!.parentId);
      }
    }
    if (!actionable.resourceId && !actionable.text && !actionable.description) throw new Error("android_node_requires_selector");
    return {
      ...(actionable.resourceId ? { resourceId: actionable.resourceId } : {}),
      ...(actionable.text ? { text: actionable.text } : {}),
      ...(actionable.description ? { description: actionable.description } : {}),
      ...(actionable.class ? { className: actionable.class } : {}),
      ...(actionable.packageName ? { packageName: actionable.packageName } : {}),
    };
  }
  private async wait(selector: AndroidSelector, present: boolean, timeoutMs: number, signal?: AbortSignal) {
    const deadline = Date.now() + timeoutMs;
    const query = rpcSelector(selector);
    do {
      signal?.throwIfAborted();
      const remaining = Math.max(0, deadline - Date.now());
      const slice = Math.min(500, remaining), started = Date.now();
      // Short native waits keep stop responsive and do not leave a long device-side wait behind.
      if (await this.server.call<boolean>(present ? "waitForExists" : "waitUntilGone", [query, slice], signal)) return true;
      const rest = slice - (Date.now() - started);
      if (rest > 0) await delay(rest, undefined, { signal });
    } while (Date.now() < deadline);
    return false;
  }
  private async resolve(selector: AndroidSelector, timeoutMs: number, signal?: AbortSignal, reference?: { snapshot: Snapshot; nodeId: number }) {
    if (!await this.wait(selector, true, timeoutMs, signal)) throw new Error("android_node_not_found");
    const query = rpcSelector(selector);
    const hierarchy = compactSnapshot(await this.server.call<string>("dumpWindowHierarchy", [false], signal));
    if (reference && (this.latest !== reference.snapshot || !sameReference(reference.snapshot, hierarchy, reference.nodeId))) {
      this.invalidate();
      throw new Error("android_snapshot_expired");
    }
    const matches = matchingNodes(hierarchy.nodes, selector);
    if (!matches.length) throw new Error("android_node_not_found");
    if (matches.length > 1) {
      const snapshot = { ...hierarchy, snapshotId: randomUUID() };
      this.latest = snapshot;
      return {
        error: "android_node_ambiguous" as const, snapshotId: snapshot.snapshotId, totalMatches: matches.length,
        truncated: matches.length > MAX_AMBIGUOUS_CANDIDATES,
        candidates: matches.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((node) => ({
          ...node, parent: hierarchy.nodes.find((item) => item.id === node.parentId),
        })),
      };
    }
    const node = await this.server.call<NodeInfo>("objInfo", [query], signal);
    if (!node.enabled) throw new Error("android_node_disabled");
    return { query, node };
  }
  private async reportPointer(feedback: PointerFeedback | undefined, points: OperationPoint[], durationMs?: number, signal?: AbortSignal): Promise<void> {
    if (!feedback) return;
    const { width, height } = await this.screen(signal);
    feedback(points, durationMs, { width, height });
  }
  private async longPress(point: OperationPoint, durationMs: number, signal?: AbortSignal, feedback?: PointerFeedback) {
    this.invalidate();
    await this.reportPointer(feedback, [point], durationMs, signal);
    // UIAutomator2's coordinate click overload holds and releases on-device,
    // so aborting the HTTP wait does not leave a host-managed finger down.
    if (!await this.server.call<boolean>("click", [point.x, point.y, durationMs], signal)) throw new Error("android_action_rejected");
  }
  async act(input: unknown, shell: (args: string[]) => Promise<unknown>, signal?: AbortSignal, feedback?: PointerFeedback, requireScreenshot = false): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("android_invalid_action");
    const args = input as Record<string, unknown>;
    const touchAction = args.action === "tap" || args.action === "long_press";
    const coordinateAction = args.action === "swipe" || (touchAction && args.selector === undefined && args.nodeId === undefined && args.snapshotId === undefined);
    if (requireScreenshot && coordinateAction && (typeof args.screenshotId !== "string" || !args.screenshotId)) throw new Error("android_screenshot_required");
    if (requireScreenshot && coordinateAction && args.coordinateSpace !== "image-pixels" && args.coordinateSpace !== "normalized-1000") throw new Error("android_invalid_coordinate_space");
    const visual = args.screenshotId !== undefined || args.coordinateSpace !== undefined;
    if (visual && (!(touchAction || args.action === "swipe") || args.selector !== undefined || args.snapshotId !== undefined || args.nodeId !== undefined)) throw new Error("android_invalid_action");
    const holdDuration = args.action === "long_press" ? gestureDuration(args.durationMs, 800) : undefined;
    if (args.action === "wait") {
      if (args.state !== "present" && args.state !== "absent") throw new Error("android_invalid_action");
      const selector = parseSelector(args.selector);
      const started = Date.now();
      const matched = await this.wait(selector, args.state === "present", timeout(args.timeoutMs, 15_000), signal);
      return { matched, timedOut: !matched, state: args.state, elapsedMs: Date.now() - started };
    }
    const selectorTouch = touchAction && (args.selector !== undefined || args.nodeId !== undefined || args.snapshotId !== undefined);
    if (selectorTouch || args.action === "text") {
      if (args.x !== undefined || args.y !== undefined) throw new Error("android_invalid_action");
      if (args.action === "text" && (typeof args.text !== "string" || args.text.length > 20_000)) throw new Error("android_invalid_text");
      const selector = this.nodeSelector(args, args.action as "tap" | "long_press" | "text");
      const reference = args.snapshotId !== undefined ? { snapshot: this.latest!, nodeId: args.nodeId as number } : undefined;
      const resolved = await this.resolve(selector, timeout(args.timeoutMs), signal, reference);
      if ("error" in resolved) return { executed: false, ...resolved };
      const { query, node } = resolved;
      if (selectorTouch) {
        if (holdDuration !== undefined) {
          const point = { x: Math.floor((node.bounds.left + node.bounds.right) / 2), y: Math.floor((node.bounds.top + node.bounds.bottom) / 2) };
          await this.longPress(point, holdDuration, signal, feedback);
          return { executed: true, selector, target: { resourceId: node.resourceName, bounds: node.bounds }, durationMs: holdDuration };
        }
        this.invalidate();
        await this.reportPointer(feedback, [{ x: (node.bounds.left + node.bounds.right) / 2, y: (node.bounds.top + node.bounds.bottom) / 2 }], undefined, signal);
        if (!await this.server.call<boolean>("click", [query], signal)) throw new Error("android_action_rejected");
        return { executed: true, selector, target: { resourceId: node.resourceName, bounds: node.bounds } };
      }
      this.invalidate();
      const text = args.text;
      if (!await this.server.call<boolean>("setText", [query, text], signal)) throw new Error("android_action_rejected");
      // Do not reuse text matching after changing the field's value.
      const readSelector = { ...selector }; delete readSelector.text; delete readSelector.textContains;
      const result = await this.resolve(Object.keys(readSelector).length ? readSelector : { focused: true }, 0, signal);
      if ("error" in result) return { executed: true, textMatched: null, ...result };
      return { executed: true, text: result.node.text, textMatched: result.node.text === text };
    }
    const mapped = visual
      ? this.screenshots.resolve(args, await this.screen(signal)) : undefined;
    if (holdDuration !== undefined) {
      await this.longPress(screenPoint(mapped?.command ?? args), holdDuration, signal, feedback);
      return { executed: true, durationMs: holdDuration, ...(mapped ? { coordinates: mapped.coordinates } : {}) };
    }
    const command = actionArguments(mapped?.command ?? args);
    if (args.action === "tap" || args.action === "swipe") {
      const points = [{ x: Number(command[3]), y: Number(command[4]) }];
      if (args.action === "swipe") points.push({ x: Number(command[5]), y: Number(command[6]) });
      await this.reportPointer(feedback, points, args.action === "swipe" ? Number(command[7]) : undefined, signal);
    }
    this.latest = undefined;
    if (!mapped) this.screenshots.invalidate();
    await shell(command);
    return { executed: true, ...(mapped ? { coordinates: mapped.coordinates } : {}) };
  }
}

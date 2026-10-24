import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { actionArguments } from "../command.js";
import { compactSnapshot } from "../snapshot.js";
import type { AdbTarget, AndroidSelector } from "../types.js";
import { UiAutomatorServer } from "./server.js";
import { matchingNodes, parseSelector, rpcSelector, timeout } from "./selector.js";

type DeviceInfo = { displayWidth: number; displayHeight: number; displayRotation: number };
type NodeInfo = { text: string | null; resourceName: string; className: string; enabled: boolean; bounds: { left: number; top: number; right: number; bottom: number } };
type Snapshot = ReturnType<typeof compactSnapshot> & { snapshotId: string };

export class AndroidAutomation {
  private readonly server: UiAutomatorServer;
  private latest?: Snapshot;
  constructor(target: AdbTarget, root: string, fetcher: typeof fetch = fetch) { this.server = new UiAutomatorServer(target, root, fetcher); }
  start(signal?: AbortSignal) { return this.server.start(signal); }
  close() { this.invalidate(); return this.server.close(); }
  invalidate(): void { this.latest = undefined; }
  async screen(signal?: AbortSignal) {
    const info = await this.server.call<DeviceInfo>("deviceInfo", [], signal);
    return { width: info.displayWidth, height: info.displayHeight, rotation: info.displayRotation, coordinates: "screen-pixels" as const };
  }
  async snapshot(signal?: AbortSignal) {
    this.invalidate();
    const xml = await this.server.call<string>("dumpWindowHierarchy", [false], signal);
    const parsed = compactSnapshot(xml);
    const screen = await this.screen(signal);
    if (parsed.rotation !== screen.rotation) throw new Error("android_layout_changed");
    const snapshot = { ...parsed, snapshotId: randomUUID() };
    this.latest = snapshot;
    return { ...snapshot, screen };
  }
  private nodeSelector(args: Record<string, unknown>, tap: boolean): AndroidSelector {
    if (args.selector !== undefined) {
      if (args.nodeId !== undefined || args.snapshotId !== undefined) throw new Error("android_invalid_selector");
      return parseSelector(args.selector);
    }
    if (args.nodeId === undefined && args.snapshotId === undefined) return { focused: true };
    if (!this.latest || args.snapshotId !== this.latest.snapshotId) throw new Error("android_snapshot_expired");
    const node = this.latest.nodes.find((node) => node.id === args.nodeId);
    if (!node) throw new Error("android_node_not_found");
    let actionable = node;
    if (tap && !node.clickable) {
      let parent = node.parentId === undefined ? undefined : this.latest.nodes.find((item) => item.id === node.parentId);
      while (parent) {
        if (parent.clickable) { actionable = parent; break; }
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
  private async resolve(selector: AndroidSelector, timeoutMs: number, signal?: AbortSignal) {
    if (!await this.wait(selector, true, timeoutMs, signal)) throw new Error("android_node_not_found");
    const query = rpcSelector(selector);
    const nodes = compactSnapshot(await this.server.call<string>("dumpWindowHierarchy", [false], signal)).nodes;
    const count = matchingNodes(nodes, selector).length;
    if (!count) throw new Error("android_node_not_found");
    if (count > 1) throw new Error("android_node_ambiguous");
    const node = await this.server.call<NodeInfo>("objInfo", [query], signal);
    if (!node.enabled) throw new Error("android_node_disabled");
    return { query, node };
  }
  async act(input: unknown, shell: (args: string[]) => Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("android_invalid_action");
    const args = input as Record<string, unknown>;
    if (args.action === "wait") {
      if (args.state !== "present" && args.state !== "absent") throw new Error("android_invalid_action");
      const selector = parseSelector(args.selector);
      const started = Date.now();
      const matched = await this.wait(selector, args.state === "present", timeout(args.timeoutMs, 15_000), signal);
      return { matched, timedOut: !matched, state: args.state, elapsedMs: Date.now() - started };
    }
    const selectorTap = args.action === "tap" && (args.selector !== undefined || args.nodeId !== undefined || args.snapshotId !== undefined);
    if (selectorTap || args.action === "text") {
      if (args.x !== undefined || args.y !== undefined) throw new Error("android_invalid_action");
      if (args.action === "text" && (typeof args.text !== "string" || args.text.length > 20_000)) throw new Error("android_invalid_text");
      const selector = this.nodeSelector(args, selectorTap);
      const { query, node } = await this.resolve(selector, timeout(args.timeoutMs), signal);
      this.invalidate();
      if (selectorTap) {
        if (!await this.server.call<boolean>("click", [query], signal)) throw new Error("android_action_rejected");
        return { executed: true, selector, target: { resourceId: node.resourceName, bounds: node.bounds }, verified: false };
      }
      const text = args.text;
      if (!await this.server.call<boolean>("setText", [query, text], signal)) throw new Error("android_action_rejected");
      // Do not reuse text matching after changing the field's value.
      const readSelector = { ...selector }; delete readSelector.text; delete readSelector.textContains;
      const result = await this.resolve(Object.keys(readSelector).length ? readSelector : { focused: true }, 0, signal);
      return { executed: true, text: result.node.text, verified: result.node.text === text };
    }
    const command = actionArguments(args);
    this.invalidate();
    await shell(command);
    return { executed: true, verified: false };
  }
}

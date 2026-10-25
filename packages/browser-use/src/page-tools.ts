import type { WebContents } from "electron";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pointerAction, pressKey, targetPoint } from "./page-input.js";

type AxNode = { nodeId: string; childIds?: string[]; ignored: boolean; role?: { value: string }; name?: { value: string }; value?: { value: unknown }; properties?: { name: string; value: { value?: unknown } }[]; backendDOMNodeId?: number };

export async function pageSnapshot(page: WebContents, args: Record<string, unknown> = {}) {
  if (args.nodeId !== undefined && !Number.isInteger(args.nodeId)) throw new Error("browser_node_required");
  if (args.query !== undefined && typeof args.query !== "string") throw new Error("browser_invalid_query");
  if (!page.debugger.isAttached()) page.debugger.attach("1.3");
  const { nodes } = await page.debugger.sendCommand("Accessibility.getFullAXTree") as { nodes: AxNode[] };
  let selected = nodes;
  if (args.nodeId !== undefined) {
    const root = nodes.find((node) => node.backendDOMNodeId === args.nodeId);
    if (!root) throw new Error("browser_snapshot_node_not_found");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const subtree = new Set([root.nodeId]);
    for (const id of subtree) for (const child of byId.get(id)?.childIds ?? []) subtree.add(child);
    selected = nodes.filter((node) => subtree.has(node.nodeId));
  }
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const lines = selected.filter((node) => {
    if (node.ignored || node.role?.value === "InlineTextBox") return false;
    const structural = ["generic", "none", "presentation"].includes(node.role?.value ?? "");
    const focusable = node.properties?.some((property) => property.name === "focusable" && property.value.value === true);
    if (structural && !node.name?.value?.trim() && !node.value && !focusable) return false;
    return !query || [node.role?.value, node.name?.value, node.value?.value].some((value) => String(value ?? "").toLowerCase().includes(query));
  }).map((node) => ({
    nodeId: node.backendDOMNodeId,
    role: node.role?.value,
    name: node.name?.value,
    ...(node.value ? { value: node.value.value } : {}),
    ...Object.fromEntries((node.properties ?? []).filter((property) =>
      ["checked", "expanded", "selected"].includes(property.name) || ["disabled", "focusable"].includes(property.name) && property.value.value === true,
    ).map((property) => [property.name, property.value.value])),
  }));
  return { url: page.getURL(), title: page.getTitle(), nodes: lines };
}

export async function pageAction(page: WebContents, args: Record<string, unknown>, feedback?: import("@ohmycode/tool-contracts").PointerFeedback): Promise<void> {
  if (!page.debugger.isAttached()) page.debugger.attach("1.3");
  if (args.action === "press") {
    return pressKey(page, args.key);
  }
  if (args.action === "scroll") {
    const deltaX = args.deltaX ?? 0, deltaY = args.deltaY ?? 0;
    if (typeof deltaX !== "number" || !Number.isFinite(deltaX) || typeof deltaY !== "number" || !Number.isFinite(deltaY)) throw new Error("browser_invalid_scroll");
    const point = args.nodeId !== undefined || args.x !== undefined ? await targetPoint(page, args.nodeId, args.x, args.y) : { x: 10, y: 10 };
    await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX, deltaY });
    return;
  }
  if (["click", "double_click", "right_click", "hover", "drag"].includes(String(args.action))) return pointerAction(page, args, feedback);
  if (args.action === "type") {
    if (typeof args.text !== "string") throw new Error("browser_text_required");
    await page.debugger.sendCommand("Input.insertText", { text: args.text });
    return;
  }
  if (args.action !== "fill") throw new Error("browser_invalid_action");
  if (!Number.isInteger(args.nodeId)) throw new Error("browser_node_required");
  if (args.action === "fill" && typeof args.text !== "string") throw new Error("browser_text_required");
  await callNode(page, args.nodeId,
    "function(text) { this.scrollIntoView({block:'center'}); this.focus(); if (this.isContentEditable) { this.textContent = text; } else { const prototype = this.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set; setter.call(this, text); } this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }", [args.text]);
}

async function callNode(page: WebContents, nodeId: unknown, functionDeclaration: string, values: unknown[] = []): Promise<void> {
  const { object } = await page.debugger.sendCommand("DOM.resolveNode", { backendNodeId: nodeId }) as { object: { objectId: string } };
  try {
    const response = await page.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration,
      arguments: values.map((value) => ({ value })),
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error("browser_element_action_failed");
  } finally {
    await page.debugger.sendCommand("Runtime.releaseObject", { objectId: object.objectId });
  }
}

export async function evaluatePage(page: WebContents, expression: unknown): Promise<unknown> {
  if (typeof expression !== "string" || !expression.trim()) throw new Error("browser_expression_required");
  const response = await page.debugger.sendCommand("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(`browser_script_failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
  const result = response.result.unserializableValue ?? response.result.value ?? null;
  const serialized = JSON.stringify(result);
  return serialized.length > 32_000 ? { truncated: true, preview: serialized.slice(0, 32_000), totalCharacters: serialized.length } : { value: result };
}

export async function uploadFiles(page: WebContents, nodeId: unknown, paths: unknown): Promise<unknown> {
  if (!Number.isInteger(nodeId)) throw new Error("browser_node_required");
  if (!Array.isArray(paths)) throw new Error("browser_files_required");
  for (const path of paths) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new Error("browser_absolute_file_path_required");
    if (!(await stat(path)).isFile()) throw new Error("browser_upload_requires_file");
  }
  if (paths.length === 0) {
    await callNode(page, nodeId, "function() { if (this.type !== 'file') throw new Error('File input required'); this.value = ''; this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }");
  } else await page.debugger.sendCommand("DOM.setFileInputFiles", { backendNodeId: nodeId, files: paths });
  return { uploaded: paths.length };
}

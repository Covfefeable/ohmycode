import type { WebContents } from "electron";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pointerAction, pressKey, targetPoint } from "./page-input.js";

type AxNode = { ignored: boolean; role?: { value: string }; name?: { value: string }; value?: { value: unknown }; backendDOMNodeId?: number };

export async function pageSnapshot(page: WebContents) {
  if (!page.debugger.isAttached()) page.debugger.attach("1.3");
  const { nodes } = await page.debugger.sendCommand("Accessibility.getFullAXTree") as { nodes: AxNode[] };
  const lines = nodes.filter((node) => !node.ignored).map((node) => ({
    nodeId: node.backendDOMNodeId,
    role: node.role?.value,
    name: node.name?.value,
    ...(node.value ? { value: node.value.value } : {}),
  }));
  return { url: page.getURL(), title: page.getTitle(), nodes: lines.slice(0, 500), truncated: lines.length > 500 };
}

export async function pageAction(page: WebContents, args: Record<string, unknown>): Promise<void> {
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
  if (["click", "double_click", "right_click", "hover", "drag"].includes(String(args.action))) return pointerAction(page, args);
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

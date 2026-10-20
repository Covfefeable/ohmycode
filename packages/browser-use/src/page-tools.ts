import type { WebContents } from "electron";

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
    const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8 };
    const key = String(args.key);
    if (!(key in codes)) throw new Error("browser_invalid_key");
    await page.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: codes[key] });
    await page.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: codes[key] });
    return;
  }
  if (args.action === "scroll") {
    if (typeof args.deltaY !== "number" || !Number.isFinite(args.deltaY)) throw new Error("browser_invalid_scroll");
    await page.debugger.sendCommand("Runtime.evaluate", { expression: `window.scrollBy(0, ${args.deltaY})` });
    return;
  }
  if (args.action !== "click" && args.action !== "fill") throw new Error("browser_invalid_action");
  if (!Number.isInteger(args.nodeId)) throw new Error("browser_node_required");
  if (args.action === "fill" && typeof args.text !== "string") throw new Error("browser_text_required");
  const { object } = await page.debugger.sendCommand("DOM.resolveNode", { backendNodeId: args.nodeId }) as { object: { objectId: string } };
  try {
    const response = await page.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: args.action === "click"
        ? "function() { this.scrollIntoView({block:'center'}); this.click(); }"
        : "function(text) { this.focus(); if (this.isContentEditable) { this.textContent = text; } else { const prototype = this.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set; setter.call(this, text); } this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }",
      arguments: args.action === "fill" ? [{ value: args.text }] : [],
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error("browser_element_action_failed");
  } finally {
    await page.debugger.sendCommand("Runtime.releaseObject", { objectId: object.objectId });
  }
}

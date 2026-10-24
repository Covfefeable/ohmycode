import type { WebContents } from "electron";
import process from "node:process";

type Point = { x: number; y: number };
// CDP key events do not resolve macOS native editing shortcuts automatically.
const macEditingCommands: Record<string, string> = {
  "Meta+a": "selectAll", "Meta+c": "copy", "Meta+x": "cut",
  "Meta+v": "paste", "Meta+z": "undo", "Meta+Shift+z": "redo",
};

export async function targetPoint(page: WebContents, nodeId: unknown, x: unknown, y: unknown, scroll = true): Promise<Point> {
  if (nodeId !== undefined) {
    if (!Number.isInteger(nodeId)) throw new Error("browser_invalid_node");
    if (scroll) await page.debugger.sendCommand("DOM.scrollIntoViewIfNeeded", { backendNodeId: nodeId });
    const { quads } = await page.debugger.sendCommand("DOM.getContentQuads", { backendNodeId: nodeId }) as { quads: number[][] };
    const quad = quads[0];
    if (!quad) throw new Error("browser_element_not_visible");
    return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
  }
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) throw new Error("browser_target_required");
  return { x, y };
}

export async function pointerAction(page: WebContents, args: Record<string, unknown>): Promise<void> {
  const start = await targetPoint(page, args.nodeId, args.x, args.y);
  await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  if (args.action === "hover") return;
  const button = args.action === "right_click" ? "right" : "left";
  if (args.action === "drag") {
    // Both endpoints must share the viewport; do not scroll after resolving the source.
    const end = await targetPoint(page, args.targetNodeId, args.targetX, args.targetY, false);
    await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button, clickCount: 1 });
    try {
      for (let step = 1; step <= 12; step++) {
        await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12, button, buttons: 1 });
      }
    } finally { await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button, clickCount: 1 }); }
    return;
  }
  const count = args.action === "double_click" ? 2 : 1;
  for (let clickCount = 1; clickCount <= count; clickCount++) {
    await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button, clickCount });
    await page.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", ...start, button, clickCount });
  }
}

export async function pressKey(page: WebContents, value: unknown): Promise<void> {
  if (typeof value !== "string" || !value) throw new Error("browser_invalid_key");
  const parts = value.split("+");
  const keyName = parts.pop()!;
  const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
  let modifiers = 0;
  for (const part of parts) {
    if (!(part in modifierBits)) throw new Error("browser_invalid_modifier");
    modifiers |= modifierBits[part];
  }
  const codes: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 };
  const key = keyName === "Space" ? " " : keyName;
  const windowsVirtualKeyCode = codes[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : undefined);
  if (windowsVirtualKeyCode === undefined) throw new Error("browser_invalid_key");
  const command = process.platform === "darwin" ? macEditingCommands[[...parts].sort().concat(key.toLowerCase()).join("+")] : undefined;
  await page.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers, windowsVirtualKeyCode, ...(command ? { commands: [command] } : {}), ...(key.length === 1 && (modifiers & 7) === 0 ? { text: key } : {}) });
  await page.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers, windowsVirtualKeyCode });
}

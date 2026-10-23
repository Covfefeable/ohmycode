import type { WebContents } from "electron";
import { setTimeout } from "node:timers/promises";

export function prepareWait(args: Record<string, unknown>): { expression: string; timeoutMs: number } {
  const timeoutMs = args.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 30_000) throw new Error("browser_invalid_wait_timeout");
  const state = args.state ?? "visible";
  if (state !== "visible" && state !== "hidden") throw new Error("browser_invalid_wait_state");
  const value = args.condition === "text" ? args.text : args.condition === "selector" ? args.selector : args.condition === "url" ? args.url : undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("browser_wait_condition_required");
  if (args.condition === "url" && state !== "visible") throw new Error("browser_url_wait_requires_visible_state");
  const encoded = JSON.stringify(value);
  const expression = args.condition === "url" ? `location.href.includes(${encoded})` : args.condition === "text" ? `(document.body?.innerText ?? '').includes(${encoded})` :
    `Array.from(document.querySelectorAll(${encoded})).some(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse'; })`;
  return { expression: state === "hidden" ? `!(${expression})` : expression, timeoutMs: Number(timeoutMs) };
}

/** Poll inside one tool invocation, not through repeated model round trips. */
export async function pollPageCondition(page: WebContents, expression: string, signal: AbortSignal): Promise<{ matched: true }> {
  for (;;) {
    signal.throwIfAborted();
    const response = await page.debugger.sendCommand("Runtime.evaluate", { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error(`browser_wait_condition_failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    signal.throwIfAborted();
    if (response.result.value === true) return { matched: true };
    await setTimeout(100, undefined, { signal });
  }
}

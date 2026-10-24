import type { AndroidSelector } from "../types.js";
import type { compactSnapshot } from "../snapshot.js";

// UIAutomator2 3.7.1 selector mask constants, not local heuristic matching rules.
const fields = { text: 0x01, textContains: 0x02, className: 0x10, description: 0x40, focused: 0x020000, packageName: 0x080000, resourceId: 0x200000 };
export function parseSelector(input: unknown): AndroidSelector {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("android_invalid_selector");
  const entries = Object.entries(input);
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(fields, key) || (key === "focused" ? typeof value !== "boolean" : typeof value !== "string" || !value.length))) throw new Error("android_invalid_selector");
  return input as AndroidSelector;
}
export function rpcSelector(selector: AndroidSelector) {
  return { mask: (Object.keys(selector) as (keyof AndroidSelector)[]).reduce((mask, key) => mask | fields[key], 0), childOrSibling: [], childOrSiblingSelector: [], ...selector };
}
/** Uniqueness check on the live hierarchy; upstream count uses legacy UiSelector, unlike objInfo/click. */
export function matchingNodes(nodes: ReturnType<typeof compactSnapshot>["nodes"], selector: AndroidSelector) {
  return nodes.filter((node) => Object.entries(selector).every(([key, value]) => {
    if (key === "textContains") return (node.text ?? "").includes(value as string);
    if (key === "className") return node.class === value;
    if (key === "focused") return Boolean(node.focused) === value;
    return node[key as "text" | "resourceId" | "description" | "packageName"] === value;
  }));
}
export function timeout(value: unknown, defaultValue = 5000): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 120_000) throw new Error("android_invalid_timeout");
  return value;
}

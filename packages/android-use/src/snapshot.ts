import { DOMParser, type Node } from "@xmldom/xmldom";

const flagNames = ["clickable", "long-clickable", "scrollable", "focusable", "focused", "checkable", "checked", "selected", "password"] as const;

/** Keep actionable ancestry while omitting empty layout wrappers and XML boilerplate. */
export function compactSnapshot(xml: string) {
  const document = new DOMParser({ onError() { throw new Error("android_invalid_snapshot"); } }).parseFromString(xml, "application/xml");
  if (document.documentElement?.tagName !== "hierarchy") throw new Error("android_invalid_snapshot");
  const elements = Array.from(document.getElementsByTagName("node"));
  const ancestry = new Map<Node | null, { parentId?: number; actionableParentId?: number }>();
  const nodes = elements.flatMap((element, index) => {
    const parent = ancestry.get(element.parentNode) ?? {};
    const text = element.getAttribute("text");
    const description = element.getAttribute("content-desc");
    const resourceId = element.getAttribute("resource-id");
    const flags = Object.fromEntries(flagNames.filter((name) => element.getAttribute(name) === "true").map((name) => [name, true])) as Partial<Record<typeof flagNames[number], true>>;
    const actionable = flags.clickable || flags["long-clickable"] || flags.scrollable || flags.focusable;
    if (!text?.trim() && !description?.trim() && !resourceId && !Object.keys(flags).length) {
      ancestry.set(element, parent);
      return [];
    }
    const id = index + 1;
    ancestry.set(element, { parentId: id, actionableParentId: actionable ? id : parent.actionableParentId });
    return [{ id, ...parent,
      class: element.getAttribute("class"), packageName: element.getAttribute("package"), bounds: element.getAttribute("bounds"),
      ...(text ? { text } : {}), ...(description ? { description } : {}), ...(resourceId ? { resourceId } : {}),
      ...flags, ...(element.getAttribute("enabled") === "false" ? { enabled: false } : {}),
    }];
  });
  return { rotation: Number(document.documentElement.getAttribute("rotation") ?? 0),
    packages: [...new Set(elements.map((element) => element.getAttribute("package")).filter(Boolean))], nodes };
}

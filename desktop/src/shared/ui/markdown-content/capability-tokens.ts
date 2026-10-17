import type { Link, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";

export const CAPABILITY_LINK_PREFIX = "#ohmycode-capability-";

export function remarkCapabilityTokens() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "link" || node.type === "linkReference") return SKIP;
      if (node.type !== "text" || !parent || index === undefined) return;
      const parts: (Text | Link)[] = [];
      let cursor = 0;
      for (const match of node.value.matchAll(/\[\[(mcp|skill):([^\]]+)\]\]/g)) {
        if (match.index > cursor) parts.push({ type: "text", value: node.value.slice(cursor, match.index) });
        parts.push({ type: "link", url: `${CAPABILITY_LINK_PREFIX}${match[1]}-${encodeURIComponent(match[2])}`, children: [{ type: "text", value: match[2] }] });
        cursor = match.index + match[0].length;
      }
      if (cursor === 0) return;
      if (cursor < node.value.length) parts.push({ type: "text", value: node.value.slice(cursor) });
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

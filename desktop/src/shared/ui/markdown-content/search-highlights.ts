import type { Emphasis, Root, Text } from "mdast";
import { visit } from "unist-util-visit";

export function searchParts(text: string, query: string) {
  const parts: { text: string; matched: boolean }[] = [];
  if (!query.trim()) return [{ text, matched: false }];
  const pattern = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), matched: false });
    parts.push({ text: match[0], matched: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}

export function remarkSearchHighlights({ query }: { query: string }) {
  return (tree: Root) => {
    if (!query.trim()) return;
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const parts = searchParts(node.value, query);
      if (!parts.some((part) => part.matched)) return;
      const replacements: (Text | Emphasis)[] = parts.map((part) => part.matched
        ? { type: "emphasis", data: { hName: "mark" }, children: [{ type: "text", value: part.text }] }
        : { type: "text", value: part.text });
      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
}

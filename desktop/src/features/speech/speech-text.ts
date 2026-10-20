import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export type ReadableMessage = Pick<LocalMessage, "id" | "content" | "activity">;

export function speechText(markdown: string): string {
  function read(node: Nodes): string {
    if (
      node.type === "code" ||
      node.type === "html" ||
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "definition"
    )
      return "";
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "break") return "\n";
    if ("children" in node) {
      const text = node.children.map(read).join("");
      return ["paragraph", "heading", "listItem", "tableRow"].includes(
        node.type,
      )
        ? `${text}\n`
        : text;
    }
    return "";
  }
  return read(fromMarkdown(markdown))
    .replace(/\[\[(?:mcp|skill):[^\]]*\]\]/g, "")
    .trim();
}

/** Activity message items already include the final answer; don't read it twice. */
export function messageSpeechText(message: ReadableMessage): string {
  const parts = (message.activity ?? [])
    .filter((step) => step.type === "message")
    .map((step) => step.content);
  if (message.content.trim() && parts.at(-1)?.trim() !== message.content.trim())
    parts.push(message.content);
  return parts.map(speechText).filter(Boolean).join("\n");
}

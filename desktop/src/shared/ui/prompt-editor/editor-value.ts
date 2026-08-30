import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { $createCapabilityTokenNode } from "./CapabilityTokenNode";
import { $createMentionTokenNode } from "./MentionTokenNode";
import type { PromptMentionOption, PromptTokenOption } from "./types";

const TOKEN_PATTERN = /\[\[(mcp|skill):([^\]]+)\]\]/g;

function tokenLabel(kind: "mcp" | "skill", payload: string, options: PromptTokenOption[]) {
  const serializedValue = `[[${kind}:${payload}]]`;
  const option = options.find((item) => item.serializedValue === serializedValue);
  return { serializedValue, label: option?.label ?? payload };
}

function valuePattern(mentions: PromptMentionOption[]) {
  const names = mentions.map((item) => item.label).sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`${TOKEN_PATTERN.source}${names.length ? `|@(${names.join("|")})(?=\\s|$|[.,，。])` : ""}`, "g");
}

export function $setPromptValue(value: string, options: PromptTokenOption[], mentions: PromptMentionOption[] = []) {
  const root = $getRoot();
  root.clear();
  const lines = value.split("\n");
  for (const line of lines) {
    const paragraph = $createParagraphNode();
    let cursor = 0;
    for (const match of line.matchAll(valuePattern(mentions))) {
      const index = match.index ?? 0;
      if (index > cursor) paragraph.append($createTextNode(line.slice(cursor, index)));
      if (match[3]) {
        paragraph.append($createMentionTokenNode(match[3]));
      } else {
        const kind = match[1] as "mcp" | "skill";
        const token = tokenLabel(kind, match[2], options);
        paragraph.append($createCapabilityTokenNode(kind, token.label, token.serializedValue));
      }
      cursor = index + match[0].length;
    }
    if (cursor < line.length) paragraph.append($createTextNode(line.slice(cursor)));
    root.append(paragraph);
  }
  if (!lines.length) root.append($createParagraphNode());
}

export function $getPromptValue() {
  return $getRoot().getChildren().map((node) => node.getTextContent()).join("\n");
}

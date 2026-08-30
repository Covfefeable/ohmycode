import type { NodeKey, SerializedLexicalNode } from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import type { JSX } from "react";
import styles from "./PromptEditor.module.css";

type SerializedMentionTokenNode = SerializedLexicalNode & { label: string };

export class MentionTokenNode extends DecoratorNode<JSX.Element> {
  __label: string;

  static getType() { return "mention-token"; }
  static clone(node: MentionTokenNode) { return new MentionTokenNode(node.__label, node.__key); }
  constructor(label: string, key?: NodeKey) { super(key); this.__label = label; }
  isInline() { return true; }
  createDOM() { const span = document.createElement("span"); span.className = styles.tokenHost; return span; }
  updateDOM() { return false; }
  getTextContent() { return `@${this.getLatest().__label}`; }
  decorate() { return <span className={styles.mentionToken} contentEditable={false}>@{this.__label}</span>; }
  exportJSON(): SerializedMentionTokenNode { return { type: "mention-token", version: 1, label: this.__label }; }
  static importJSON(value: SerializedMentionTokenNode) { return $createMentionTokenNode(value.label); }
}

export function $createMentionTokenNode(label: string) {
  return $applyNodeReplacement(new MentionTokenNode(label));
}

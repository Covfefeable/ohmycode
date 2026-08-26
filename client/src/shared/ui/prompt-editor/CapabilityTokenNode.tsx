import type { NodeKey, SerializedLexicalNode } from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import type { JSX } from "react";
import styles from "./PromptEditor.module.css";

type SerializedCapabilityTokenNode = SerializedLexicalNode & {
  kind: "mcp" | "skill";
  label: string;
  serializedValue: string;
};

export class CapabilityTokenNode extends DecoratorNode<JSX.Element> {
  __kind: "mcp" | "skill";
  __label: string;
  __serializedValue: string;

  static getType() { return "capability-token"; }
  static clone(node: CapabilityTokenNode) {
    return new CapabilityTokenNode(node.__kind, node.__label, node.__serializedValue, node.__key);
  }

  constructor(kind: "mcp" | "skill", label: string, serializedValue: string, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__label = label;
    this.__serializedValue = serializedValue;
  }

  isInline() { return true; }
  createDOM() {
    const span = document.createElement("span");
    span.className = styles.tokenHost;
    return span;
  }
  updateDOM() { return false; }
  getTextContent() { return this.getLatest().__serializedValue; }
  decorate() {
    return <span className={styles.token} data-kind={this.__kind} contentEditable={false}>
      <span className={styles.tokenKind}>{this.__kind === "mcp" ? "MCP" : "S"}</span>
      <span>{this.__label}</span>
    </span>;
  }
  exportJSON(): SerializedCapabilityTokenNode {
    return { type: "capability-token", version: 1, kind: this.__kind, label: this.__label, serializedValue: this.__serializedValue };
  }
  static importJSON(value: SerializedCapabilityTokenNode) {
    return $createCapabilityTokenNode(value.kind, value.label, value.serializedValue);
  }
}

export function $createCapabilityTokenNode(kind: "mcp" | "skill", label: string, serializedValue: string) {
  return $applyNodeReplacement(new CapabilityTokenNode(kind, label, serializedValue));
}

export function $isCapabilityTokenNode(node: unknown): node is CapabilityTokenNode {
  return node instanceof CapabilityTokenNode;
}

import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownContent.module.css";

function codeText(children: ReactNode): string {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode }>(child)) return "";
  return String(child.props.children ?? "").replace(/\n$/, "");
}

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? child.props.className ?? "" : "";
  const language = className.match(/language-([^\s]+)/)?.[1];
  const content = codeText(children);

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return <div className={styles.codeBlock}>
    <div className={styles.codeToolbar}>
      <span>{language ?? t("common.code")}</span>
      <button type="button" onClick={() => void copy()} aria-label={copied ? t("common.copied") : t("common.copy")}>
        {copied ? <Check /> : <Copy />}
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
    <pre {...props}>{children}</pre>
  </div>;
}

const CAPABILITY_LINK_PREFIX = "#ohmycode-capability-";

function renderCapabilityTokens(markdown: string) {
  return markdown.replace(/\[\[(mcp|skill):([^\]]+)\]\]/g, (_match, kind: string, value: string) => {
    const label = value.replaceAll("[", "\\[").replaceAll("]", "\\]");
    return `[${label}](${CAPABILITY_LINK_PREFIX}${kind}-${encodeURIComponent(value)})`;
  });
}

export function MarkdownContent({ children, className = "" }: { children: string; className?: string }) {
  return <div className={`${styles.root} ${className}`.trim()}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: CodeBlock,
        a: ({ children: label, href, ...props }) => href?.startsWith(CAPABILITY_LINK_PREFIX)
          ? <span className={styles.capabilityToken}><span>{href.startsWith(`${CAPABILITY_LINK_PREFIX}mcp-`) ? "MCP" : "S"}</span>{label}</span>
          : <a {...props} href={href} target="_blank" rel="noreferrer">{label}</a>,
        table: ({ children: rows, ...props }) => <div className={styles.tableScroll}><table {...props}>{rows}</table></div>,
      }}
    >{renderCapabilityTokens(children)}</ReactMarkdown>
  </div>;
}

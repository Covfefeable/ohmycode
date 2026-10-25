import { useMemo } from "react";
import Anser from "anser";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../../../../shared/ui/markdown-content";
import { MarkdownImage } from "../../../../shared/ui/image-preview/MarkdownImage";
import { ValueTree } from "./ValueTree";
import styles from "./ResultContent.module.css";

function AnsiText({ children }: { children: string }) {
  const parts = useMemo(() => Anser.ansiToJson(children, { use_classes: true, remove_empty: true }), [children]);
  return <code>{parts.map((part, index) => <span key={index}
    className={[part.fg && `${part.fg}-fg`, part.bg && `${part.bg}-bg`, ...part.decorations.map((value) => `ansi-${value}`)].filter(Boolean).join(" ")}
    style={{ color: part.fg_truecolor ? `rgb(${part.fg_truecolor})` : undefined, backgroundColor: part.bg_truecolor ? `rgb(${part.bg_truecolor})` : undefined }}
  >{part.content}</span>)}</code>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function TextContent({ value }: { value: string }) {
  const structured = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" ? parsed : undefined;
    } catch { return undefined; }
  }, [value]);
  return structured !== undefined ? <ValueTree value={structured} /> : <MarkdownContent className={styles.text}>{value}</MarkdownContent>;
}

export function PlainTextContent({ value }: { value: string }) {
  return <pre className={styles.output}>{value}</pre>;
}

export function TerminalContent({ input, value }: { input: Record<string, unknown>; value: unknown }) {
  const { t } = useTranslation();
  const result = record(value);
  const metadata = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "output" && key !== "error"));
  return <div className={styles.terminal}>
    {typeof input.command === "string" && <pre className={styles.command}>{input.command}</pre>}
    {typeof result.error === "string" && <p className={styles.error} role="alert">{result.error}</p>}
    {typeof result.output === "string" ? <pre className={styles.output}><AnsiText>{result.output}</AnsiText></pre> : <StructuredContent value={value} />}
    {Object.keys(metadata).length > 0 && <details className={styles.metadata}><summary>{t("agent.toolExecutionInfo")}{result.exitCode !== undefined ? ` · ${t("agent.toolExitCode", { code: String(result.exitCode) })}` : ""}</summary><ValueTree value={metadata} /></details>}
  </div>;
}

export function StructuredContent({ value }: { value: unknown }) {
  const { t } = useTranslation();
  if (value === undefined) return <p className={styles.caption}>{t("agent.toolNoOutput")}</p>;
  if (typeof value === "string") return <TextContent value={value} />;
  const result = record(value);
  const source = result.imageRef ?? result.dataUrl;
  if (typeof source === "string" && (result.contentKind === "image" || result.type === "image" || String(result.mimeType).startsWith("image/"))) {
    return <MarkdownImage src={source} name={String(result.path ?? result.mimeType ?? "")} />;
  }
  if (Array.isArray(result.content)) {
    const { content, isError, ...metadata } = result;
    return <div className={styles.blocks}>{(content as unknown[]).map((item, index) => {
      const block = record(item);
      return <div key={index}>{block.type === "text" && typeof block.text === "string" ? <TextContent value={block.text} />
        : block.type === "resource" ? <StructuredContent value={block.resource} /> : <StructuredContent value={item} />}</div>;
    })}{isError === true && <p className={styles.error} role="alert">{t("agent.toolFailed")}</p>}{Object.keys(metadata).length > 0 && <ValueTree value={metadata} />}</div>;
  }
  if (typeof result.text === "string" && typeof result.mimeType === "string") return <TextContent value={result.text} />;
  return <>{typeof result.error === "string" && <p className={styles.error} role="alert">{result.error}</p>}<ValueTree value={value} /></>;
}

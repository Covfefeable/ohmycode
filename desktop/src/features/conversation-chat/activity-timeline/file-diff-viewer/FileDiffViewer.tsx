import { DiffEditor, Editor } from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { useMonacoTheme } from "../../../../shared/lib/monaco";
import { useTranslation } from "react-i18next";
import styles from "./FileDiffViewer.module.css";


export type FileChange = {
  path: string;
  original?: string;
  modified?: string;
  diffUnavailable?: "file_too_large";
};

function fileName(value: string): string {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || value;
}

function languageFor(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", css: "css", json: "json", md: "markdown", html: "html", yml: "yaml", yaml: "yaml" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

function contentWithoutToolLineNumbers(output: string, startLine: number): string {
  return output.split("\n").map((line, index) => {
    const prefix = `${startLine + index}: `;
    return line.startsWith(prefix) ? line.slice(prefix.length) : line;
  }).join("\n");
}

function editorHeight(...contents: string[]): string {
  const lines = Math.max(...contents.map((content) => content.split("\n").length));
  return `min(var(--tool-editor-max-height, 360px), ${Math.max(120, lines * 18 + 24)}px)`;
}


export function FileContentViewer({ content, path, startLine = 1 }: { content: string; path: string; startLine?: number }) {
  const theme = useMonacoTheme();
  const language = useMemo(() => languageFor(path), [path]);
  const value = useMemo(() => contentWithoutToolLineNumbers(content, startLine), [content, startLine]);
  return <div className={styles.root}>
    <Editor
      height={editorHeight(value)}
      language={language}
      options={{ automaticLayout: true, domReadOnly: true, fontSize: 12, lineNumbers: (line) => String(line + startLine - 1), lineNumbersMinChars: 3, minimap: { enabled: false }, readOnly: true, scrollBeyondLastLine: false }}
      theme={theme}
      value={value}
    />
  </div>;
}

export function FileDiffViewer({ changes }: { changes: FileChange[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const theme = useMonacoTheme();
  const change = changes[Math.min(selected, changes.length - 1)];
  const language = useMemo(() => languageFor(change.path), [change.path]);
  return <div className={styles.root}>
    {changes.length > 1 && <div className={styles.tabs}>{changes.map((item, index) => <button className={index === selected ? styles.activeTab : styles.tab} key={item.path} onClick={() => setSelected(index)} type="button">{fileName(item.path)}</button>)}</div>}
    {change.diffUnavailable
      ? <div className={styles.unavailable}>{t("agent.diffTooLarge")}</div>
      : <>
          <div className={styles.labels}><span>{t("agent.originalContent")}</span><span>{t("agent.currentContent")}</span></div>
          <DiffEditor
            height={editorHeight(change.original ?? "", change.modified ?? "")}
            language={language}
            modified={change.modified ?? ""}
            original={change.original ?? ""}
            options={{ automaticLayout: true, fontSize: 12, lineNumbersMinChars: 3, minimap: { enabled: false }, readOnly: true, renderSideBySide: true, scrollBeyondLastLine: false }}
            theme={theme}
          />
        </>}
  </div>;
}

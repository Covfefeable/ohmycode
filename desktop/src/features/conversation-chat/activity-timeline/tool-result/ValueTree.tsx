import { ObjectInspector, chromeLight } from "react-inspector";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./ValueTree.module.css";

const theme: typeof chromeLight = {
  ...chromeLight,
  BASE_BACKGROUND_COLOR: "transparent",
  BASE_COLOR: "var(--color-text-muted)",
  BASE_FONT_FAMILY: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  BASE_FONT_SIZE: "12px",
  BASE_LINE_HEIGHT: 1.7,
  OBJECT_NAME_COLOR: "var(--color-text-soft)",
  OBJECT_VALUE_STRING_COLOR: "var(--color-accent)",
  OBJECT_VALUE_NUMBER_COLOR: "var(--color-warning)",
  OBJECT_VALUE_BOOLEAN_COLOR: "var(--color-warning)",
  OBJECT_VALUE_NULL_COLOR: "var(--color-text-dim)",
  OBJECT_VALUE_UNDEFINED_COLOR: "var(--color-text-dim)",
  ARROW_COLOR: "var(--color-text-dim)",
};

function ObjectTree({ value }: { value: unknown }) {
  // @ts-expect-error v9 types omit the library's documented object-theme support.
  return <ObjectInspector data={value} theme={theme} expandLevel={1} />;
}

function isTable(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row));
}

function DataTable({ value }: { value: Record<string, unknown>[] }) {
  const { t } = useTranslation();
  const [count, setCount] = useState(50);
  const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
  return <div>
    <div className={styles.table}><table>
      <thead><tr>{columns.map((key) => <th key={key} scope="col">{key}</th>)}</tr></thead>
      <tbody>{value.slice(0, count).map((row, index) => <tr key={index}>{columns.map((key) => {
        const cell = row[key];
        const structured = cell !== null && typeof cell === "object";
        const text = cell === null ? "null" : String(cell ?? "");
        return <td key={key} title={structured ? undefined : text}>{structured ? <ObjectTree value={cell} /> : text}</td>;
      })}</tr>)}</tbody>
    </table></div>
    {count < value.length && <button className={styles.more} type="button" onClick={() => setCount((current) => current + 50)}>{t("agent.toolMore", { count: value.length - count })}</button>}
  </div>;
}

export function ValueTree({ value }: { value: unknown }) {
  if (isTable(value)) return <DataTable value={value} />;
  const entries = value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
  const collections = entries.filter((entry): entry is [string, Record<string, unknown>[]] => isTable(entry[1]));
  if (!collections.length) return <ObjectTree value={value} />;
  const metadata = Object.fromEntries(entries.filter(([, item]) => !isTable(item)));
  return <div className={styles.collections}>
    {Object.keys(metadata).length > 0 && <ObjectTree value={metadata} />}
    {collections.map(([key, rows]) => <section key={key} aria-label={key}><div className={styles.label}>{key} <span>{rows.length}</span></div><DataTable value={rows} /></section>)}
  </div>;
}

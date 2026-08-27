import styles from "./CapabilityToken.module.css";

export function CapabilityToken({ kind, label }: { kind: "mcp" | "skill"; label: React.ReactNode }) {
  return <span className={styles.token} data-kind={kind}>
    <span className={styles.kind}>{kind === "mcp" ? "MCP" : "S"}</span>
    <span className={styles.label}>{label}</span>
  </span>;
}

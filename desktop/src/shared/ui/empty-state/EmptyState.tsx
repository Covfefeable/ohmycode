import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export function EmptyState({ icon, title, description, compact = false, centered = false }: { icon: ReactNode; title: string; description?: string; compact?: boolean; centered?: boolean }) {
  return <div className={`${styles.empty} ${compact ? styles.compact : ""} ${centered ? styles.centered : ""}`}>{icon}<strong>{title}</strong>{description && <span>{description}</span>}</div>;
}

import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export function EmptyState({ icon, title, description, compact = false }: { icon: ReactNode; title: string; description?: string; compact?: boolean }) {
  return <div className={`${styles.empty} ${compact ? styles.compact : ""}`}>{icon}<strong>{title}</strong>{description && <span>{description}</span>}</div>;
}

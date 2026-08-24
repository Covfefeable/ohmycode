import type { ReactNode } from "react";
import styles from "./SettingsSectionHeader.module.css";

export function SettingsSectionHeader({ title, description, actions }: { title: string; description: string; actions: ReactNode }) {
  return <header className={styles.header}><div><h2>{title}</h2><p>{description}</p></div><div className={styles.actions}>{actions}</div></header>;
}

import type { PropsWithChildren } from "react";
import { LanguageSwitcher } from "../../features/language-switcher";
import styles from "./AuthLayout.module.css";

export function AuthLayout({ children }: PropsWithChildren) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>OM</div>
        <div className={styles.language}><LanguageSwitcher /></div>
      </header>
      <section className={styles.panel}>{children}</section>
      <div className={styles.context} aria-hidden="true">
        <span>›_</span>
        <div className={styles.line} />
        <div className={styles.lineShort} />
      </div>
    </main>
  );
}


import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { AuthBackground } from "../../features/auth-background";
import { BrandLogo } from "../../shared/ui/brand-logo";
import styles from "./AuthLayout.module.css";

export function AuthLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  return (
    <main className={styles.page}>
      <AuthBackground />
      <header className={styles.header}>
        <div className={styles.brand} aria-label="OhMyCode"><BrandLogo /></div>
      </header>
      <section className={styles.panel}>{children}</section>
      <div className={styles.context}>
        <div className={styles.contextCopy}><strong>OhMyCode</strong><span>{t("auth.workspaceTagline")}</span></div>
      </div>
    </main>
  );
}

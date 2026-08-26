import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { AuthBackground } from "../../features/auth-background";
import { LanguageSwitcher } from "../../features/language-switcher";
import { ThemeToggle } from "../../features/theme-toggle";
import { BrandLogo } from "../../shared/ui/brand-logo";
import { BrandText } from "../../shared/ui/brand-text";
import styles from "./AuthLayout.module.css";

export function AuthLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  return (
    <main className={styles.page}>
      <AuthBackground />
      <header className={styles.header}>
        <div className={styles.brand} aria-label="OhMyCode"><BrandLogo /></div>
        <div className={styles.controls}>
          <LanguageSwitcher compact />
          <ThemeToggle className={styles.themeToggle} />
        </div>
      </header>
      <section className={styles.panel}>{children}</section>
      <div className={styles.context}>
        <div className={styles.contextCopy}><strong><BrandText text="OhMyCode" /></strong><span>{t("auth.workspaceTagline")}</span></div>
      </div>
    </main>
  );
}

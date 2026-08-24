import type { PropsWithChildren, ReactNode } from "react";
import styles from "./AppShell.module.css";

type AppShellProps = PropsWithChildren<{
  navigation: ReactNode;
  sidebar: ReactNode;
}>;

export function AppShell({ navigation, sidebar, children }: AppShellProps) {
  return (
    <main className={styles.shell}>
      {navigation}
      {sidebar}
      {children}
    </main>
  );
}


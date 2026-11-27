import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import styles from "./IconButton.module.css";

type IconButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    size?: "compact" | "default" | "comfortable";
    tone?: "neutral" | "danger";
  }
>;

export function IconButton({ active = false, size = "default", tone = "neutral", className = "", ...props }: IconButtonProps) {
  const classes = [styles.button, styles[size], tone === "danger" ? styles.danger : "", active ? styles.active : "", className].filter(Boolean).join(" ");
  return <button type="button" className={classes} {...props} />;
}


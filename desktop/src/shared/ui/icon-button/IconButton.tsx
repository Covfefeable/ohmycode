import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import styles from "./IconButton.module.css";

type IconButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>;

export function IconButton({ active = false, className = "", ...props }: IconButtonProps) {
  const classes = [styles.button, active ? styles.active : "", className].filter(Boolean).join(" ");
  return <button className={classes} {...props} />;
}


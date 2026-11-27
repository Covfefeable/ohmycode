import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "compact" | "default" | "comfortable";
};

export function Button({ variant = "secondary", size = "default", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")} {...props} />;
}

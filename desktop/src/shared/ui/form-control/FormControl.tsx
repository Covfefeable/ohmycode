import type { ComponentPropsWithRef } from "react";
import styles from "./FormControl.module.css";

export function TextInput({ className = "", ...props }: ComponentPropsWithRef<"input">) {
  return <input className={[styles.control, styles.input, className].filter(Boolean).join(" ")} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea className={[styles.control, styles.textarea, className].filter(Boolean).join(" ")} {...props} />;
}

export function FormField({ className = "", ...props }: ComponentPropsWithRef<"label">) {
  return <label className={[styles.field, className].filter(Boolean).join(" ")} {...props} />;
}

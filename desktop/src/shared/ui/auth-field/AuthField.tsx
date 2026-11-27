import { FormField, TextInput } from "../form-control";
import type { InputHTMLAttributes } from "react";
import styles from "./AuthField.module.css";

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function AuthField({ label, error, id, ...props }: AuthFieldProps) {
  return (
    <FormField className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <TextInput id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />
      {error && <small id={`${id}-error`} role="alert">{error}</small>}
    </FormField>
  );
}


import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../auth-session";
import { AuthField } from "../../shared/ui/auth-field";
import { BrandText } from "../../shared/ui/brand-text";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const result = await login(email, password);
    if (!result.ok) setError(t(`auth.errors.${result.code}`));
    setSubmitting(false);
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.heading}>
        <p>{t("auth.signInEyebrow")}</p>
        <h1><BrandText text={t("auth.signInTitle")} /></h1>
        <span>{t("auth.signInDescription")}</span>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <AuthField id="email" type="email" autoComplete="email" required label={t("auth.email")} placeholder={t("auth.emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} />
      <AuthField id="password" type="password" autoComplete="current-password" required label={t("auth.password")} placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} />
      <button className={styles.submit} disabled={submitting}>{submitting ? t("auth.signingIn") : t("auth.signIn")}</button>
      <p className={styles.switch}>{t("auth.noAccount")} <Link to="/register">{t("auth.createAccount")}</Link></p>
    </form>
  );
}

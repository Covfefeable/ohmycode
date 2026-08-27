import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../auth-session";
import { AuthField } from "../../shared/ui/auth-field";
import { BrandText } from "../../shared/ui/brand-text";
import styles from "./RegisterForm.module.css";

export function RegisterForm() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError(t("auth.errors.password_mismatch"));
      return;
    }
    setSubmitting(true);
    const result = await register(displayName, email, password);
    if (!result.ok) setError(t(`auth.errors.${result.code}`));
    setSubmitting(false);
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.heading}>
        <p>{t("auth.registerEyebrow")}</p>
        <h1><BrandText text={t("auth.registerTitle")} /></h1>
        <span>{t("auth.registerDescription")}</span>
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <AuthField id="displayName" autoComplete="name" required minLength={2} label={t("auth.displayName")} placeholder={t("auth.displayNamePlaceholder")} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <AuthField id="registerEmail" type="email" autoComplete="email" required label={t("auth.email")} placeholder={t("auth.emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} />
      <AuthField id="registerPassword" type="password" autoComplete="new-password" required minLength={8} label={t("auth.password")} placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} />
      <AuthField id="confirmPassword" type="password" autoComplete="new-password" required minLength={8} label={t("auth.confirmPassword")} placeholder={t("auth.confirmPasswordPlaceholder")} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
      <button className={styles.submit} disabled={submitting}>{submitting ? t("auth.creatingAccount") : t("auth.createAccount")}</button>
      <p className={styles.switch}>{t("auth.hasAccount")} <Link to="/login">{t("auth.signIn")}</Link></p>
    </form>
  );
}

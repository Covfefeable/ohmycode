import styles from "./BrandText.module.css";

const BRAND = "OhMyCode";

type Props = { text: string };

export function BrandText({ text }: Props) {
  const index = text.indexOf(BRAND);
  if (index < 0) return text;
  return <>{text.slice(0, index)}Oh<span className={styles.accent}>My</span>Code{text.slice(index + BRAND.length)}</>;
}

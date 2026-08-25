import darkLogo from "../../../assets/ohmycode-logo-dark.png";
import lightLogo from "../../../assets/ohmycode-logo-light.png";
import styles from "./BrandLogo.module.css";

export function BrandLogo() {
  return <span className={styles.logo} aria-hidden="true">
    <img className={styles.dark} src={darkLogo} alt="" />
    <img className={styles.light} src={lightLogo} alt="" />
  </span>;
}

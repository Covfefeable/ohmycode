import { lazy, Suspense, useEffect, useState } from "react";
import { AUTH_LIQUID_ETHER_COLORS, AUTH_LIQUID_ETHER_PROPS } from "@ohmycode/web-effects/auth-liquid-ether";
import styles from "./AuthBackground.module.css";

const LiquidEther = lazy(() => import("@ohmycode/web-effects").then(({ LiquidEther }) => ({ default: LiquidEther })));

export function AuthBackground() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    const idle = window.requestIdleCallback(() => setReady(true), { timeout: 500 });
    return () => { query.removeEventListener("change", update); window.cancelIdleCallback(idle); };
  }, []);
  const light = document.documentElement.dataset.theme === "light";
  return <div className={styles.background} aria-hidden="true">
    {ready && !reducedMotion && <Suspense fallback={null}><LiquidEther
      {...AUTH_LIQUID_ETHER_PROPS}
      colors={light ? AUTH_LIQUID_ETHER_COLORS.light : AUTH_LIQUID_ETHER_COLORS.dark}
    /></Suspense>}
  </div>;
}

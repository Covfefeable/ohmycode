import { lazy, Suspense, useEffect, useState } from "react";
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
      colors={light ? ["#dcefe1", "#72b886", "#18843a"] : ["#08130c", "#22773b", "#7dff98"]}
      mouseForce={16}
      cursorSize={90}
      resolution={0.4}
      autoSpeed={0.35}
      autoIntensity={1.5}
    /></Suspense>}
  </div>;
}

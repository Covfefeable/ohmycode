import { LiquidEther } from "@ohmycode/web-effects";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./AuthVisual.styles";

export function AuthVisual() {
  const { mode } = useTheme();
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return <View pointerEvents="none" style={styles.fill}>
    {!reducedMotion && <LiquidEther
      autoIntensity={1.25}
      autoSpeed={0.3}
      colors={mode === "dark" ? ["#08130c", "#22773b", "#7dff98"] : ["#dcefe1", "#72b886", "#18843a"]}
      cursorSize={90}
      mouseForce={14}
      resolution={0.4}
    />}
  </View>;
}

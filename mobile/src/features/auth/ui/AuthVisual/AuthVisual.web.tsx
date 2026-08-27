import { AUTH_LIQUID_ETHER_COLORS, AUTH_LIQUID_ETHER_PROPS, LiquidEther } from "@ohmycode/web-effects";
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
      {...AUTH_LIQUID_ETHER_PROPS}
      colors={mode === "dark" ? AUTH_LIQUID_ETHER_COLORS.dark : AUTH_LIQUID_ETHER_COLORS.light}
    />}
  </View>;
}

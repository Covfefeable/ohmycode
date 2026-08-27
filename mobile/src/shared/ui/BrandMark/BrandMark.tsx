import { Image } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./BrandMark.styles";

export function BrandMark() {
  const { mode } = useTheme();
  return <Image
    accessibilityIgnoresInvertColors
    source={mode === "dark" ? require("../../../../assets/images/ohmycode-logo-dark.png") : require("../../../../assets/images/ohmycode-logo-light.png")}
    style={styles.mark}
  />;
}

import { View } from "react-native";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./AuthVisual.styles";

export function AuthVisual() {
  const { colors } = useTheme();
  return <View pointerEvents="none" style={[styles.fill, { backgroundColor: colors.accentSoft }]} />;
}

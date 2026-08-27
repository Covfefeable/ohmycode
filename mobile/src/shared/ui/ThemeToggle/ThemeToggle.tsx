import { Pressable, Text } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./ThemeToggle.styles";

export function ThemeToggle() {
  const { colors, mode, toggle } = useTheme();
  return (
    <Pressable
      accessibilityLabel="Toggle color theme"
      onPress={toggle}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Text style={[styles.icon, { color: colors.text }]}>{mode === "dark" ? "☼" : "◐"}</Text>
    </Pressable>
  );
}

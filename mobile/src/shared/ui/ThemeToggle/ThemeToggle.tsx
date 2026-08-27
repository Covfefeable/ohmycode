import Feather from "@expo/vector-icons/Feather";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./ThemeToggle.styles";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { colors, mode, toggle } = useTheme();
  return (
    <Pressable
      accessibilityLabel={t("theme.toggle")}
      onPress={toggle}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Feather color={colors.text} name={mode === "dark" ? "sun" : "moon"} size={17} />
    </Pressable>
  );
}

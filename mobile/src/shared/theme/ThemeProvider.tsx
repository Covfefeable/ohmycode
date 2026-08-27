import { darkColors, lightColors, type ThemeColors, type ThemeMode } from "@ohmycode/design-tokens";
import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";

type ThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  toggle(): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemMode = useColorScheme() === "light" ? "light" : "dark";
  const [override, setOverride] = useState<ThemeMode | null>(null);
  const mode = override ?? systemMode;
  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: mode === "dark" ? darkColors : lightColors,
      mode,
      toggle: () => setOverride((current) => (current ?? systemMode) === "dark" ? "light" : "dark"),
    }),
    [mode, systemMode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is missing");
  return value;
}

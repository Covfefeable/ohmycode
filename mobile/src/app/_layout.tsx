import "@/shared/i18n/i18n";

import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { AuthProvider, useAuth } from "@/features/auth/model/AuthProvider";
import { ThemeProvider, useTheme } from "@/shared/theme/ThemeProvider";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { colors, mode } = useTheme();
  const { ready } = useAuth();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const navigationTheme = mode === "dark" ? DarkTheme : DefaultTheme;
  return (
    <NavigationThemeProvider
      value={{
        ...navigationTheme,
        colors: {
          ...navigationTheme.colors,
          background: colors.canvas,
          card: colors.surface,
          border: colors.border,
          primary: colors.accent,
          text: colors.text,
        },
      }}
    >
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

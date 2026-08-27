import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/features/auth/model/AuthProvider";

export default function AuthLayout() {
  const { user } = useAuth();
  if (user) return <Redirect href="/(app)" />;
  return <Stack screenOptions={{ headerShown: false, animation: "fade" }} />;
}

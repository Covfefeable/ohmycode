import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/features/auth/model/AuthProvider";

export default function AppLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

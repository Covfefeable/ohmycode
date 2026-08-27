import { Redirect } from "expo-router";

import { useAuth } from "@/features/auth/model/AuthProvider";

export default function IndexRoute() {
  const { user } = useAuth();
  return <Redirect href={user ? "/(app)" : "/(auth)/login"} />;
}

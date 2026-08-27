import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { listMobileConversations } from "@/features/chat/api/mobile-chat-api";
import { useTheme } from "@/shared/theme/ThemeProvider";

export function RecentChatRedirect() {
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    let active = true;
    void listMobileConversations()
      .then((conversations) => {
        if (!active) return;
        router.replace({
          pathname: "/(app)/chat/[id]",
          params: { id: conversations[0]?.id ?? "new" },
        });
      })
      .catch(() => {
        if (active) router.replace({ pathname: "/(app)/chat/[id]", params: { id: "new" } });
      });
    return () => { active = false; };
  }, [router]);

  return <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator color={colors.accent} /></View>;
}

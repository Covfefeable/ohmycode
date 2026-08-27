import { useLocalSearchParams } from "expo-router";

import { ChatScreen } from "@/features/chat/ui/ChatScreen/ChatScreen";

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen conversationId={id} />;
}

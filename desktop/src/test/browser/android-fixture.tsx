import { createRoot } from "react-dom/client";
import { AndroidPanel } from "../../features/android/AndroidPanel";
import { useAndroidState } from "../../features/android/useAndroidState";
import { FeedbackProvider } from "../../features/feedback";
import { i18n } from "../../app/i18n";
import "../../app/global.css";

export function Fixture() {
  const { state } = useAndroidState();
  return <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
    <main style={{ flex: 1, minWidth: "min(var(--browser-chat-min-width, 0px), 75%)" }}>Conversation</main>
    {state && <AndroidPanel conversationId="thread" state={state} active onClose={() => {}} />}
  </div>;
}
await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<FeedbackProvider><Fixture /></FeedbackProvider>);

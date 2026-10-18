import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { VirtuosoHandle } from "react-virtuoso";
import { MessageList } from "../../features/conversation-chat/message-list/MessageList";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { ActivityExpansionProvider } from "../../features/conversation-chat/activity-timeline/ActivityExpansionProvider";
import { useActivityExpansion } from "../../features/conversation-chat/activity-timeline/expansion-state";
import { i18n } from "../../app/i18n";
import "../../app/tokens.css";
import styles from "./chat-fixture.module.css";

const message = (index: number): LocalMessage => ({
  id: String(index), role: "assistant", content: `Message ${index}\n\n**Evidence**\n\n${"A line of text. ".repeat(Math.abs(index) % 4 + 1)}`,
  createdAt: "2026-10-18T00:00:00Z",
});

declare global {
  interface Window {
    chatFixture: { append(): void; stream(): void; prepend(): void; growComposer(): void; follow(): boolean };
  }
}

function Message({ value }: { value: LocalMessage }) {
  const [open, toggle] = useActivityExpansion(`fixture-${value.id}`, false);
  return <article className={styles.message} data-message={value.id}>
    <MarkdownContent>{value.content}</MarkdownContent>
    <button aria-expanded={open} onClick={() => toggle((current) => !current)}>Details</button>
    {open && <p>Expanded evidence for {value.id}</p>}
  </article>;
}

export function ChatFixture() {
  const [messages, setMessages] = useState(() => Array.from({ length: 1000 }, (_, index) => message(index)));
  const [prepended, setPrepended] = useState(0);
  const [clearance, setClearance] = useState(150);
  const nextId = useRef(1000);
  const listRef = useRef<VirtuosoHandle>(null);
  const followRef = useRef(true);
  useEffect(() => { window.chatFixture = {
    append: () => { const next = message(nextId.current++); setMessages((current) => [...current, next]); },
    stream: () => setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + "\n\nStreaming paragraph." } : item)),
    prepend: () => {
      setMessages((current) => [...Array.from({ length: 20 }, (_, index) => message(index - prepended - 20)), ...current]);
      setPrepended((count) => count + 20);
    },
    growComposer: () => setClearance(270),
    follow: () => followRef.current,
  }; }, [prepended]);
  return <div className={styles.shell}>
    <header className={styles.header}>Conversation header</header>
    <main className={styles.main}>
      <ActivityExpansionProvider><MessageList messages={messages} prependedCount={prepended} clearance={clearance} active loading={false} failed={false} loadOlder={async () => {}} listRef={listRef} followRef={followRef} renderMessage={(value) => <Message value={value} />} /></ActivityExpansionProvider>
      <div className={styles.dock} data-composer style={{ height: clearance - 54 }}>Composer</div>
    </main>
  </div>;
}

await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<ChatFixture />);

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationChat } from "../../features/conversation-chat";
import { ProjectList } from "../../features/project-list";
import { FeedbackProvider } from "../../features/feedback";
import { SpeechProvider } from "../../features/speech/SpeechProvider";
import { DebugPanel } from "../../features/debug-panel";
import { MemoryRouter } from "react-router-dom";
import type { MessageLocation } from "../../entities/conversation/types";
import type { BrowserState } from "@ohmycode/browser-use/types";
import { i18n } from "../../app/i18n";
import "../../app/global.css";
import styles from "./search-fixture.module.css";

const messages: LocalMessage[] = Array.from({ length: 101 }, (_, index) => ({
  id: `m-${index}`, role: "assistant", content: index === 5 || index === 55 ? `needle evidence ${index}` : `Ordinary message ${index}`,
  createdAt: "2026-10-18T00:00:00Z",
}));
const conversation = { id: "thread", title: "Fixture conversation", createdAt: messages[0].createdAt, updatedAt: messages[0].createdAt };
const project: LocalProject = { id: "project", name: "Fixture project", path: "/fixture", deviceId: "test", deviceName: "Test", conversations: [conversation] };
const listeners = new Set<(event: RuntimeEvent) => void>();
let sequence = 3;
declare global { interface Window { searchFixture: { emitDelta(): void } } }
window.searchFixture = { emitDelta() { for (const listener of listeners) listener({ type: "item.delta", threadId: "thread", turnId: "live", sequence: ++sequence, itemId: "live-answer", delta: " background continues" }); } };
let browserState: BrowserState = { tabs: [], selectedId: null, opened: false, detached: false };
const browserListeners = new Set<(state: BrowserState) => void>();

Object.defineProperty(window, "ohmycode", { configurable: true, value: {
  browser: {
    reserveSpace: async () => window.innerWidth,
    state: async () => browserState,
    onState: (_id: string, listener: (state: BrowserState) => void) => { browserListeners.add(listener); return () => browserListeners.delete(listener); },
    setOpened: async (_id: string, opened: boolean) => {
      browserState = { ...browserState, opened };
      for (const listener of browserListeners) listener(browserState);
      return browserState;
    },
    layout: async () => {},
  },
  debug: {
    getConfig: async () => ({ apiUrl: "http://localhost:8765" }),
    contextSnapshot: async (conversationId: string) => ({ conversationId, title: "Fixture conversation", snapshot: {
      capturedAt: "2026-10-20T00:00:00Z", runId: "turn", executionId: "execution", step: 2, status: "completed",
      body: { model: "actual-request-model", messages: [{ role: "system", content: "Actual system prompt" }, { role: "user", content: "Actual user input" }], tools: [{ type: "function", function: { name: "read_file" } }] },
      estimatedTokens: 100, contextLength: 4096, compacted: false, messageCount: 2, toolCount: 1, requestBytes: 1000,
      usage: { prompt_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } },
    } }),
  },
  projects: { list: async () => [project], searchConversations: async (query: string) => query === "needle" ? [{ projectId: project.id, projectName: project.name, conversation, messageId: "m-55", snippet: "needle evidence 55" }] : [] },
  capabilities: { onChanged: () => () => {}, listMcp: async () => [], listSkills: async () => [] },
  settings: { onModelsChanged: () => () => {}, listModels: async () => [] },
  speech: {
    getSettings: async () => ({ workspaceId: "llm-test", voice: "longanhuan_v3.1", autoPlay: false, hasApiKey: true }),
    setAutoPlay: async (enabled: boolean) => ({ workspaceId: "llm-test", voice: "longanhuan_v3.1", autoPlay: enabled, hasApiKey: true }),
    stop: () => {},
  },
  conversations: {
    onThreadEvent: (_id: string, listener: (event: RuntimeEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    onFollowups: () => () => {}, followups: async () => ({ inputs: [], paused: false }),
    threadSnapshot: async () => ({ threadId: "thread", turnId: "live", status: "in_progress", lastSequence: 3, events: [
      { type: "turn.started", threadId: "thread", turnId: "live", sequence: 1 },
      { type: "item.started", threadId: "thread", turnId: "live", sequence: 2, item: { id: "live-answer", threadId: "thread", turnId: "live", kind: "agent_message", status: "in_progress", content: "" } },
      { type: "item.delta", threadId: "thread", turnId: "live", sequence: 3, itemId: "live-answer", delta: "Live output" },
    ] }),
    history: async (_id: string, options: { around?: string; before?: string; after?: string } = {}) => {
      const at = Number((options.around ?? options.before ?? options.after ?? "m-101").slice(2));
      const start = options.around ? Math.max(0, at - 20) : options.after ? at + 1 : Math.max(0, at - 40);
      const end = options.around ? Math.min(101, at + 21) : options.after ? Math.min(101, at + 41) : at;
      return { ...conversation, messages: messages.slice(start, end), olderCursor: start > 0 ? `m-${start}` : null, newerCursor: end < 101 ? `m-${end - 1}` : null };
    },
    searchMessages: async (_id: string, options: { query: string; at?: string; direction?: "next" | "previous" }) => {
      const matches = messages.filter((message) => message.content.toLowerCase().includes(options.query.toLowerCase()));
      let index = matches.findIndex((message) => message.id === options.at);
      if (index < 0) index = 0;
      else if (options.direction === "next") index = (index + 1) % matches.length;
      else if (options.direction === "previous") index = (index - 1 + matches.length) % matches.length;
      return { messageId: matches[index]?.id ?? null, position: matches.length ? index + 1 : 0, total: matches.length };
    },
  },
} });

export function SearchFixture() {
  const [location, setLocation] = useState<MessageLocation>();
  return <MemoryRouter><FeedbackProvider><DebugPanel /><div className={styles.shell}>
    <aside className={styles.sidebar}><ProjectList selectedConversationId="thread" refreshToken={0} heading={<h2>Workspace</h2>} onConversationDelete={() => {}} onConversationSelect={(_project, _conversation, target) => setLocation(target)} /></aside>
    <div className={styles.content}><SpeechProvider><ConversationChat conversationId="thread" active searchLocation={location} onUpdated={() => {}} onBranched={() => {}} /></SpeechProvider></div>
  </div></FeedbackProvider></MemoryRouter>;
}
sessionStorage.setItem("ohmycode.activeConversationId", "thread");
await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<SearchFixture />);

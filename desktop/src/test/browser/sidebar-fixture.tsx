import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../../features/auth-session/auth-context";
import { FeedbackProvider } from "../../features/feedback";
import { ProjectList } from "../../features/project-list";
import { TokenUsageCalendar } from "../../features/token-usage-calendar";
import { NavigationRail } from "../../widgets/navigation-rail";
import { AppShell } from "../../shared/layout/app-shell";
import { i18n } from "../../app/i18n";
import "../../app/global.css";

const project = { id: "remembered-project", name: "Remembered project", path: "/fixture", deviceId: "test", deviceName: "Test", conversations: [{ id: "thread", title: "Remembered chat", createdAt: "", updatedAt: "" }] };
Object.defineProperty(window, "ohmycode", { configurable: true, value: {
  projects: { list: async () => [project] },
  settings: { get: async () => ({ profile: {} }), onProfileChanged: () => () => {} },
} });
sessionStorage.removeItem("ohmycode.workspace.expandedProjects");

export function Page({ name }: { name: string }) {
  return <AppShell navigation={<NavigationRail />} sidebar={name === "Workspace"
    ? <ProjectList selectedConversationId="thread" refreshToken={0} heading={<h2>Workspace</h2>} onConversationSelect={() => {}} onConversationDelete={() => {}} />
    : <aside>{name} sidebar</aside>}><section data-page={name}>{name} content{name === "Settings" && <TokenUsageCalendar entries={[]} />}</section></AppShell>;
}
await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<MemoryRouter><AuthContext.Provider value={{ status: "authenticated", user: null, login: async () => ({ ok: true }), register: async () => ({ ok: true }), logout: async () => {} }}><FeedbackProvider><Routes>
  <Route path="/" element={<Page name="Workspace" />} />
  <Route path="/agents" element={<Page name="Collaboration" />} />
  <Route path="/settings" element={<Page name="Settings" />} />
</Routes></FeedbackProvider></AuthContext.Provider></MemoryRouter>);

import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { BrowserWindowPage } from "../features/browser-panel/BrowserWindowPage";
import { AndroidWindowPage } from "../features/android/AndroidWindowPage";
import { OperationOverlayPage } from "../shared/ui/operation-overlay/OperationOverlay";
import { LoginPage } from "../pages/login";
import { RegisterPage } from "../pages/register";
import { AgentWorkspacePage } from "../pages/agent-workspace";
import { SettingsPage } from "../pages/settings";
import { MultiAgentPage } from "../pages/multi-agent";
import { AuthProvider, useAuth } from "../features/auth-session";
import { FullScreenLoading } from "../shared/ui/full-screen-loading";
import { WindowControls } from "../widgets/window-controls";
import { FeedbackProvider } from "../features/feedback";
import { DebugPanel } from "../features/debug-panel";
import { SpeechProvider } from "../features/speech/SpeechProvider";

function ProtectedRoute() {
  const { status } = useAuth();
  if (status === "booting") return <FullScreenLoading kind="workspace" />;
  return status === "authenticated" ? <SpeechProvider><Outlet /></SpeechProvider> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const { status } = useAuth();
  if (status === "booting") return <FullScreenLoading kind="auth" />;
  return status === "guest" || status === "unavailable" ? <Outlet /> : <Navigate to="/" replace />;
}

function MainApplication() {
  return (
      <FeedbackProvider><AuthProvider>
        <WindowControls />
        <DebugPanel />
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<AgentWorkspacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/agents" element={<MultiAgentPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider></FeedbackProvider>
  );
}

export default function App() {
  return <HashRouter><Routes>
    <Route path="/operation-overlay" element={<OperationOverlayPage />} />
    <Route path="/android" element={<FeedbackProvider><AndroidWindowPage /></FeedbackProvider>} />
    <Route path="/browser/:conversationId" element={<FeedbackProvider><BrowserWindowPage /></FeedbackProvider>} />
    <Route path="*" element={<MainApplication />} />
  </Routes></HashRouter>;
}

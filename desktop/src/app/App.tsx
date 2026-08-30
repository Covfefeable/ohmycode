import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
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

function ProtectedRoute() {
  const { status } = useAuth();
  if (status === "booting") return <FullScreenLoading />;
  return status === "authenticated" ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const { status } = useAuth();
  if (status === "booting") return <FullScreenLoading kind="auth" />;
  return status === "guest" || status === "unavailable" ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <HashRouter>
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
    </HashRouter>
  );
}

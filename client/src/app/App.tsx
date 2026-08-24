import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { LoginPage } from "../pages/login";
import { RegisterPage } from "../pages/register";
import { AgentWorkspacePage } from "../pages/agent-workspace";
import { SettingsPage } from "../pages/settings";
import { AuthProvider, useAuth } from "../features/auth-session";
import { FullScreenLoading } from "../shared/ui/full-screen-loading";
import { WindowControls } from "../widgets/window-controls";
import { FeedbackProvider } from "../features/feedback";

function ProtectedRoute() {
  const { status } = useAuth();
  if (status === "booting" || status === "unavailable") return <FullScreenLoading />;
  return status === "authenticated" ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const { status } = useAuth();
  if (status === "booting" || status === "unavailable") return <FullScreenLoading />;
  return status === "guest" ? <Outlet /> : <Navigate to="/" replace />;
}

function ProtectedPages() {
  const location = useLocation();
  const settingsVisible = location.pathname.startsWith("/settings");
  return <>
    <div style={{ display: settingsVisible ? "none" : "block" }}><AgentWorkspacePage /></div>
    <div style={{ display: settingsVisible ? "block" : "none" }}><SettingsPage /></div>
  </>;
}

export default function App() {
  return (
    <BrowserRouter>
      <FeedbackProvider><AuthProvider>
        <WindowControls />
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<ProtectedPages />} />
            <Route path="/settings" element={<ProtectedPages />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider></FeedbackProvider>
    </BrowserRouter>
  );
}

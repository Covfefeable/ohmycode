import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/i18n";
import "./app/global.css";

const storedTheme = localStorage.getItem("ohmycode.theme");
document.documentElement.dataset.theme = storedTheme === "light" ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { createRoot } from "react-dom/client";
import { ToolResultView } from "../../features/conversation-chat/activity-timeline/ToolResultView";
import { presentToolActivity } from "../../features/conversation-chat/activity-timeline/tool-presentation";
import { i18n } from "../../app/i18n";
import "../../app/global.css";

await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<main style={{ width: "min(720px, calc(100vw - 48px))", margin: "24px auto" }}>
  <section aria-label="Snapshot"><ToolResultView completed presentation={presentToolActivity("browser_snapshot", { query: "settings" }, {
    title: "Settings", nodes: Array.from({ length: 120 }, (_, index) => ({ nodeId: index, role: "button", name: `Control ${index}`, enabled: false })),
  })} /></section>
  <section aria-label="Command"><ToolResultView completed presentation={presentToolActivity("terminal", { command: "build project" }, { output: "\u001b[31mBuild failed\u001b[0m\nCheck the configuration.", exitCode: 1 })} /></section>
  <section aria-label="Structured result"><ToolResultView completed presentation={presentToolActivity("mcp__maps__geo", {}, { content: [{ type: "text", text: JSON.stringify({ return: [
    { country: "中国", province: "广东省", city: "惠州市", street: [], location: "114.539925,23.031454" },
    { country: "中国", province: "安徽省", city: "宣城市", street: [], location: "118.779037,31.010699" },
  ] }) }], isError: false })} /></section>
  <section aria-label="Multiline result"><ToolResultView completed presentation={presentToolActivity("mcp__example__text", {}, {
    content: [{ type: "text", text: "First record\n- Option A\n- Option B\nSecond record\n- Option C" }],
  })} /></section>
</main>);

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AppShell } from "./AppShell";
import { toggleSidebar, useSidebarState } from "./sidebar-state";

function Page({ name }: { name: string }) {
  const { collapsed } = useSidebarState();
  return <AppShell navigation={<button onClick={toggleSidebar}>{collapsed ? "Expand" : "Collapse"}</button>} sidebar={<aside>{name} sidebar</aside>}><section>{name} content</section></AppShell>;
}

test("侧栏状态跨三个页面共享，展开恢复之前宽度，收起时不保留拖拽柄", () => {
  let view = render(<Page name="Workspace" />);
  const separator = screen.getByRole("separator");
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  const width = separator.getAttribute("aria-valuenow");
  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  expect(screen.queryByRole("separator")).toBeNull();
  expect(document.querySelector("#app-sidebar")?.getAttribute("aria-hidden")).toBe("true");
  expect(localStorage.getItem("ohmycode.app-shell.sidebar-collapsed")).toBe("true");
  view.unmount();
  view = render(<Page name="Collaboration" />);
  expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
  view.unmount();
  render(<Page name="Settings" />);
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(width);
  expect(document.querySelector("#app-sidebar")?.getAttribute("aria-hidden")).toBe("false");
});

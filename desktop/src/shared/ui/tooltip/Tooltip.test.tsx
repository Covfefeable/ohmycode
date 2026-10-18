import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Tooltip } from "./Tooltip";

test("左边缘的 tooltip 保持视口内，滚动后关闭", () => {
  const { container } = render(<Tooltip content="Details"><button>Open</button></Tooltip>);
  const trigger = container.firstElementChild as HTMLElement;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 160, width: 160, top: 20, bottom: 40, height: 20, x: 0, y: 20, toJSON: () => {},
  });
  fireEvent.mouseEnter(trigger);
  const tooltip = screen.getByRole("tooltip");
  expect(Number.parseFloat(tooltip.style.left) - 80).toBeGreaterThanOrEqual(12);
  fireEvent.scroll(window);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("聊天内容自动滚动不关闭输入框按钮的 tooltip，所在容器滚动才关闭", () => {
  render(<><div data-testid="messages" /><div data-testid="queue"><Tooltip content="Steer"><button>Guide</button></Tooltip></div></>);
  fireEvent.mouseEnter(screen.getByRole("button", { name: "Guide" }));
  expect(screen.getByRole("tooltip").textContent).toBe("Steer");
  fireEvent.scroll(screen.getByTestId("messages"));
  expect(screen.getByRole("tooltip").textContent).toBe("Steer");
  fireEvent.scroll(screen.getByTestId("queue"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

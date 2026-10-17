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

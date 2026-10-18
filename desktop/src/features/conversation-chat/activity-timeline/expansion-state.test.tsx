import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ActivityExpansionProvider } from "./ActivityExpansionProvider";
import { useActivityExpansion } from "./expansion-state";

function Step() {
  const [open, setOpen] = useActivityExpansion("tool-1-completed", false);
  return <button aria-expanded={open} onClick={() => setOpen((current) => !current)}>Step</button>;
}

test("步骤卸载再挂载仍保留手动展开状态", () => {
  const { rerender } = render(<ActivityExpansionProvider><Step /></ActivityExpansionProvider>);
  fireEvent.click(screen.getByRole("button"));
  rerender(<ActivityExpansionProvider>{null}</ActivityExpansionProvider>);
  rerender(<ActivityExpansionProvider><Step /></ActivityExpansionProvider>);
  expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
});

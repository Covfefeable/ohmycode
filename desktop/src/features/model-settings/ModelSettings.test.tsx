import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ModelSettings } from "./ModelSettings";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));

test("模型卡片拖拽预览、排序和保存沿用同一顺序", async () => {
  const models: ModelConfiguration[] = ["One", "Two", "Three"].map((name) => ({
    id: name, name, baseUrl: "https://example.com", model: name, contextLength: 4096, hasApiKey: true, supportsVision: false,
  }));
  const saveModels = vi.fn(async (items: ModelConfiguration[]) => items);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { settings: { saveModels } } });
  const { container } = render(<ModelSettings initial={models} />);
  const articles = [...container.querySelectorAll("article")];
  articles.forEach((article, index) => {
    vi.spyOn(article, "getBoundingClientRect").mockReturnValue({ top: index * 100, bottom: index * 100 + 80, height: 80 } as DOMRect);
  });
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(articles[0].querySelector("[draggable]")!, { dataTransfer });
  fireEvent.dragEnter(articles[1], { dataTransfer });
  expect(articles[0].style.transform).toBe("translateY(100px)");
  fireEvent.drop(articles[1], { dataTransfer });
  expect([...container.querySelectorAll("article strong")].map((element) => element.textContent)).toEqual(["Two", "One", "Three"]);
  fireEvent.click(screen.getByRole("button", { name: "Save configurations" }));
  await waitFor(() => expect(saveModels).toHaveBeenCalledOnce());
  expect(saveModels.mock.calls[0][0].map((model) => model.name)).toEqual(["Two", "One", "Three"]);
});

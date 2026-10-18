import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ImagePreview } from "./ImagePreview";

const src = "data:image/png;base64,iVBORw0KGgo=";

test("图片缩略图使用图库放大，包含缩放和旋转，关闭后保留预览", async () => {
  const parentClick = vi.fn();
  render(<div onClick={parentClick}><ImagePreview src={src} name="下载.jpg" /></div>);
  expect(screen.getByRole("img").getAttribute("src")).toBe(src);
  fireEvent.click(screen.getByRole("button", { name: "Enlarge 下载.jpg" }));
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rotate" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reset view" })).toBeTruthy();
  expect(parentClick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.querySelector(".PhotoView-Slider__willClose")).not.toBeNull());
  expect(screen.getByRole("img", { name: "下载.jpg" })).toBeTruthy();
});

test("图片不可用时展示提示，不展示损坏图片或 JSON", () => {
  render(<ImagePreview name="下载.jpg" />);
  expect(screen.getByRole("status").textContent).toBe("Image preview unavailable.");
  expect(screen.queryByRole("img")).toBeNull();
});

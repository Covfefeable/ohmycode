import { expect, test } from "vitest";
import { presentToolActivity } from "./tool-presentation";

test("查看图像使用图片展示器，保留本地和网络图片结果中的数据", () => {
  for (const source of ["local", "remote"]) {
    const dataUrl = "data:image/jpeg;base64,test";
    const value = presentToolActivity("view_image", { imageUrl: "C:\\images\\下载.jpg" }, { contentKind: "image", source, dataUrl, path: "C:\\images\\下载.jpg" });
    expect(value.viewer).toBe("image");
    expect(value.imageSource).toBe(dataUrl);
    expect(value.displayResource).toBe("下载.jpg");
    expect(value.failed).toBe(false);
  }
});

test("查看图像失败保留错误语义，不作为成功图片展示", () => {
  const value = presentToolActivity("view_image", { imageUrl: "下载.jpg" }, { error: "view_image_not_found" });
  expect(value.failed).toBe(true);
  expect(value.imageSource).toBeUndefined();
  expect(value.result).toContain("view_image_not_found");
});

test("浏览器截图复用图片查看器，不把 Base64 展示成 JSON", () => {
  const result = { contentKind: "image", source: "browser", dataUrl: "data:image/png;base64,test", mimeType: "image/png" };
  const value = presentToolActivity("browser_screenshot", {}, result);
  expect(value.viewer).toBe("image");
  expect(value.imageSource).toBe(result.dataUrl);
  expect(value.result).not.toContain("base64");
});

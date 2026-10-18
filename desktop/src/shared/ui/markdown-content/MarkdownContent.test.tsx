import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ImageScopeContext } from "../image-preview/image-scope";
import { MarkdownContent } from "./MarkdownContent";

test("正文胶囊不改变代码块或行内代码的原文", () => {
  const value = "[[mcp:bing/search]]";
  const { container } = render(<MarkdownContent>{`Use ${value}\n\n\`${value}\`\n\n\`\`\`text\n${value}\n\`\`\``}</MarkdownContent>);
  expect(container.querySelectorAll('[data-kind="mcp"]')).toHaveLength(1);
  expect([...container.querySelectorAll("code")].map((node) => node.textContent?.trim())).toEqual([value, value]);
});

test("正文图片和本地图片链接通过受限 IPC 读取，包括 Windows 与 file URL", async () => {
  const previewImage = vi.fn(async () => "data:image/png;base64,test");
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { previewImage } });
  render(<ImageScopeContext.Provider value={{ conversationId: "thread" }}><MarkdownContent>{"![Relative](images/a.png)\n\n![Windows](<C:/images/a.png>)\n\n![File](file:///Users/test/a.png)\n\n[Local](images/local.jpg)"}</MarkdownContent></ImageScopeContext.Provider>);
  for (const name of ["Relative", "Windows", "File", "Local"]) expect(await screen.findByRole("img", { name })).toBeTruthy();
  expect(previewImage).toHaveBeenCalledWith({ conversationId: "thread" }, "images/a.png");
  expect(previewImage).toHaveBeenCalledWith({ conversationId: "thread" }, "C:/images/a.png");
  expect(previewImage).toHaveBeenCalledWith({ conversationId: "thread" }, "file:///Users/test/a.png");
  expect(previewImage).toHaveBeenCalledWith({ conversationId: "thread" }, "images/local.jpg");
});

test("流式更新正文不卸载已显示的图片，也不重新请求本地图片", async () => {
  const previewImage = vi.fn(async () => "data:image/png;base64,test");
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { previewImage } });
  const content = "![Preview](image.png)\n\nFirst";
  const view = (text: string) => <ImageScopeContext.Provider value={{ conversationId: "thread" }}><MarkdownContent>{text}</MarkdownContent></ImageScopeContext.Provider>;
  const { rerender } = render(view(content));
  const image = await screen.findByRole("img", { name: "Preview" });
  rerender(view(content + " second chunk"));
  expect(screen.getByRole("img", { name: "Preview" })).toBe(image);
  expect(previewImage).toHaveBeenCalledTimes(1);
});

test("外部链接保持外部打开，危险脚本链接不被保留", () => {
  render(<MarkdownContent>{"[Docs](https://example.com/docs) [Bad](javascript:alert%281%29)"}</MarkdownContent>);
  expect(screen.getByRole("link", { name: "Docs" }).getAttribute("target")).toBe("_blank");
  expect(screen.getByText("Bad").getAttribute("href")).not.toContain("javascript:");
});

test("链接中的强调文本不会被改成嵌套链接", () => {
  const { container } = render(<MarkdownContent>{"[**[[mcp:bing/search]]**](https://example.com)"}</MarkdownContent>);
  expect(screen.getByRole("link").textContent).toBe("[[mcp:bing/search]]");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelectorAll("[data-kind]")).toHaveLength(0);
});

test("搜索高亮正文、行内代码和代码块，但保持原文与链接不变", () => {
  const source = "Find **Hello** [hello](https://example.com) `HELLO`\n\n```js\nconst hello = 1;\n```";
  const { container, rerender } = render(<MarkdownContent highlightQuery="hello">{source}</MarkdownContent>);
  expect(container.querySelectorAll("mark")).toHaveLength(4);
  expect(container.querySelector("pre")?.textContent).toBe("const hello = 1;\n");
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com");
  const text = container.textContent;
  rerender(<MarkdownContent>{source}</MarkdownContent>);
  expect(container.querySelectorAll("mark")).toHaveLength(0);
  expect(container.textContent).toBe(text);
});

test("搜索按字面匹配正则特殊字符，不解释为表达式", () => {
  const { container } = render(<MarkdownContent highlightQuery="a.b">{"a.b axb"}</MarkdownContent>);
  expect(container.querySelectorAll("mark")).toHaveLength(1);
  expect(container.querySelector("mark")?.textContent).toBe("a.b");
});

test("带搜索高亮的代码块复制时不带标记或丢失字符", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<MarkdownContent highlightQuery="needle">{"```ts\nconst needle = '<mark>';\n```"}</MarkdownContent>);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith("const needle = '<mark>';");
});

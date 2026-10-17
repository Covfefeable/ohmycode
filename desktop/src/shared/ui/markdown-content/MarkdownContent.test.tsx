import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

test("正文胶囊不改变代码块或行内代码的原文", () => {
  const value = "[[mcp:bing/search]]";
  const { container } = render(<MarkdownContent>{`Use ${value}\n\n\`${value}\`\n\n\`\`\`text\n${value}\n\`\`\``}</MarkdownContent>);
  expect(container.querySelectorAll('[data-kind="mcp"]')).toHaveLength(1);
  expect([...container.querySelectorAll("code")].map((node) => node.textContent?.trim())).toEqual([value, value]);
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

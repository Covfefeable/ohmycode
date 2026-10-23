import { expect, it } from "vitest";
import { browserAddress } from "./browser-address";

it("searches plain text and preserves real addresses and explicit protocols", () => {
  for (const input of ["南京二手房", "react use effect", "123", "a&b # news"]) {
    expect(browserAddress(` ${input} `)).toBe(`https://www.baidu.com/s?wd=${encodeURIComponent(input)}`);
  }
  expect(browserAddress("example.org/path")).toBe("https://example.org/path");
  expect(browserAddress("https://example.org")).toBe("https://example.org");
  expect(browserAddress("localhost:5173/path")).toBe("https://localhost:5173/path");
  expect(browserAddress("127.0.0.1:8765")).toBe("https://127.0.0.1:8765/");
  expect(browserAddress("[::1]:8080")).toBe("https://[::1]:8080/");
  expect(browserAddress("about:blank")).toBe("about:blank");
  expect(browserAddress("javascript:alert(1)")).toBe("javascript:alert(1)");
  expect(browserAddress("   ")).toBeNull();
});

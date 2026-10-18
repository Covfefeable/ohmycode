import { expect, test } from "vitest";
import { imageReference, isLocalImageLink } from "./image-reference";

test("开发服务器图片地址解析为工作区相对路径，不按端口硬编码", () => {
  expect(imageReference("http://127.0.0.1:5173/.ohmycode-tmp/net-sample.jpg", "http://127.0.0.1:5173/")).toEqual({ local: true, source: ".ohmycode-tmp/net-sample.jpg" });
  expect(imageReference("http://localhost:9001/pic%20name.jpg", "http://localhost:9001/")).toEqual({ local: true, source: "pic name.jpg" });
});

test("本地相对路径、Windows 路径和 file URL 不通过页面服务器加载", () => {
  for (const source of ["images/test.jpg", "C:/images/下载.jpg", "file:///Users/test/images/a.jpg", "/Users/test/a.jpg"]) {
    expect(imageReference(source, "file:///app/dist/index.html")).toEqual({ local: true, source });
  }
  expect(imageReference("images/a%20b.jpg", "file:///app/dist/index.html").source).toBe("images/a b.jpg");
});

test("远程图片和 data 图片保留地址，普通远程图片链接不改为预览", () => {
  const source = "https://picsum.photos/600/400";
  expect(imageReference(source, "file:///app/dist/index.html")).toEqual({ local: false, source });
  expect(isLocalImageLink("https://example.com/a.jpg", "http://localhost:5173/")).toBe(false);
  expect(isLocalImageLink("./images/a.jpg", "file:///app/dist/index.html")).toBe(true);
});

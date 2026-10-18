import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { savePastedImage } from "../../electron/files/pasted-image";
import { MAX_IMAGE_BYTES } from "../../electron/files/image-tool";

const { getPath, createFromBuffer } = vi.hoisted(() => ({ getPath: vi.fn(), createFromBuffer: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath }, nativeImage: { createFromBuffer } }));
let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true }); directory = undefined; });

test("剪贴板图像存为持久 PNG 附件，元数据可以沿用聊天附件协议", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ohmycode-pasted-"));
  getPath.mockReturnValue(directory);
  const png = Buffer.from("PNG result");
  createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => png });
  const attachment = await savePastedImage(new Uint8Array([1, 2, 3]));
  expect(getPath).toHaveBeenCalledWith("userData");
  expect(attachment.path).toBe(path.join(directory, "attachments", "clipboard", attachment.name));
  expect(attachment.mimeType).toBe("image/png");
  expect(attachment.size).toBe(png.byteLength);
  expect(await readFile(attachment.path)).toEqual(png);
});

test("粘贴内容必须为可解码图像，输入和转换后的图片均有体积上限", async () => {
  await expect(savePastedImage(new Uint8Array(MAX_IMAGE_BYTES + 1))).rejects.toThrow("view_image_too_large");
  createFromBuffer.mockReturnValue({ isEmpty: () => true });
  await expect(savePastedImage(new Uint8Array([1]))).rejects.toThrow("view_image_not_an_image");
  createFromBuffer.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.alloc(MAX_IMAGE_BYTES + 1) });
  await expect(savePastedImage(new Uint8Array([1]))).rejects.toThrow("view_image_too_large");
});

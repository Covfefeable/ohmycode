import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { app, nativeImage } from "electron";
import { MAX_IMAGE_BYTES } from "./image-tool.js";
import type { MessageAttachment } from "../projects/types.js";

export async function savePastedImage(data: Uint8Array): Promise<MessageAttachment> {
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) throw new Error("view_image_too_large");
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) throw new Error("view_image_not_an_image");
  const png = image.toPNG();
  if (png.byteLength > MAX_IMAGE_BYTES) throw new Error("view_image_too_large");
  const id = crypto.randomUUID();
  const name = `clipboard-${id}.png`;
  const directory = path.join(app.getPath("userData"), "attachments", "clipboard");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  await writeFile(target, png, { flag: "wx" });
  return { id, name, path: target, size: png.byteLength, mimeType: "image/png" };
}

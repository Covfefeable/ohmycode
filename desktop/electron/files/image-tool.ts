import net from "node:net";
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { safeExistingPath, safeExplicitFile, workspaceDirectory } from "./workspace.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const SUPPORTED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);
const MAX_REDIRECTS = 5;

export type ViewImageArguments = { imageUrl: string; detail?: "low" | "high" };

export type ViewImageResult = {
  contentKind: "image";
  source: "local" | "remote";
  dataUrl: string;
  mimeType: string;
  byteLength: number;
  width?: number;
  height?: number;
  detail?: "low" | "high";
  path?: string;
  url?: string;
};

function mimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return "image/bmp";
  }
  return null;
}

function imageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    switch (mimeType) {
      case "image/png": {
        if (buffer.length < 24) return null;
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
      case "image/gif": {
        if (buffer.length < 10) return null;
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
      }
      case "image/bmp": {
        if (buffer.length < 26) return null;
        return { width: buffer.readUInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) };
      }
      case "image/jpeg": {
        let offset = 2;
        while (offset + 9 < buffer.length) {
          if (buffer[offset] !== 0xff) { offset += 1; continue; }
          const marker = buffer[offset + 1];
          if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            offset += 2;
            continue;
          }
          const segmentLength = buffer.readUInt16BE(offset + 2);
          const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
          if (isSof && segmentLength >= 8) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
          }
          offset += 2 + segmentLength;
        }
        return null;
      }
      case "image/webp": {
        if (buffer.length < 30) return null;
        const chunkType = buffer.subarray(12, 16).toString("ascii");
        const chunkSize = buffer.readUInt32LE(16);
        if (chunkType === "VP8X") {
          if (buffer.length < 27) return null;
          return { width: 1 + buffer.readUIntLE(21, 3), height: 1 + buffer.readUIntLE(24, 3) };
        }
        if (chunkType === "VP8 " && chunkSize >= 10) {
          return { width: buffer.readUInt16LE(25) & 0x3fff, height: buffer.readUInt16LE(27) & 0x3fff };
        }
        if (chunkType === "VP8L" && chunkSize >= 5) {
          const bits = buffer.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function dataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function fetchRemote(url: string, detail?: "low" | "high"): Promise<ViewImageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let currentUrl = new URL(url);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicRemote(currentUrl);
      response = await fetch(currentUrl, { signal: controller.signal, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("view_image_too_many_redirects");
      currentUrl = new URL(location, currentUrl);
    }
    if (!response) throw new Error("view_image_fetch_failed");
    if (!response.ok) throw new Error(`view_image_http_${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("view_image_too_large");
    const buffer = await readBoundedBody(response);
    const mimeType = SUPPORTED_MIME.has(contentType) ? contentType : mimeFromBytes(buffer);
    if (!mimeType || !SUPPORTED_MIME.has(mimeType)) throw new Error("view_image_not_an_image");
    const dimensions = imageDimensions(buffer, mimeType);
    return {
      contentKind: "image",
      source: "remote",
      url: currentUrl.toString(),
      dataUrl: dataUrl(mimeType, buffer),
      mimeType,
      byteLength: buffer.byteLength,
      ...(dimensions ?? {}),
      ...(detail ? { detail } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7));
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe8")
    || normalized.startsWith("fe9") || normalized.startsWith("fea")
    || normalized.startsWith("feb") || normalized.startsWith("ff");
}

async function assertPublicRemote(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("view_image_invalid_url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost") throw new Error("view_image_private_url");
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("view_image_private_url");
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error("view_image_empty_response");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("view_image_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function loadLocal(
  projectId: string,
  imageUrl: string,
  detail: "low" | "high" | undefined,
  workspaceRoot?: string,
  allowedPaths = new Set<string>(),
): Promise<ViewImageResult> {
  const root = await workspaceDirectory(projectId, workspaceRoot);
  let target: string;
  try {
    target = await safeExistingPath(root, imageUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("view_image_not_found", { cause: error });
    if (!imageUrl || !allowedPaths.size) throw error;
    target = await safeExplicitFile(imageUrl, allowedPaths);
  }
  const info = await stat(target);
  if (!info.isFile()) throw new Error("view_image_not_a_file");
  if (info.size > MAX_IMAGE_BYTES) throw new Error("view_image_too_large");
  const buffer = await readFile(target);
  const mimeType = mimeFromBytes(buffer);
  if (!mimeType || !SUPPORTED_MIME.has(mimeType)) throw new Error("view_image_not_an_image");
  const dimensions = imageDimensions(buffer, mimeType);
  return {
    contentKind: "image",
    source: "local",
    path: target,
    dataUrl: dataUrl(mimeType, buffer),
    mimeType,
    byteLength: buffer.byteLength,
    ...(dimensions ?? {}),
    ...(detail ? { detail } : {}),
  };
}

export async function executeViewImage(
  request: ViewImageArguments & { projectId: string },
  workspaceRoot?: string,
  allowedPaths = new Set<string>(),
): Promise<ViewImageResult> {
  const imageUrl = String(request.imageUrl ?? "").trim();
  if (!imageUrl) throw new Error("view_image_requires_imageUrl");
  const detail = request.detail === "low" ? "low" : request.detail === "high" ? "high" : undefined;
  if (/^https?:\/\//i.test(imageUrl)) return fetchRemote(imageUrl, detail);
  return loadLocal(request.projectId, imageUrl, detail, workspaceRoot, allowedPaths);
}

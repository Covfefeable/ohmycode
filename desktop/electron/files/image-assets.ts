import { createHash } from "node:crypto";
import { apiErrorFromResponse, apiFetch, apiRequest } from "../api/api-client.js";

type ImageAsset = { imageRef: string; mimeType: string; width: number; height: number };

/** Upload before journaling or sending tool output; no credentials reach Renderer. */
export async function storeImages(value: unknown, signal?: AbortSignal): Promise<unknown> {
  const uploads = new Map<string, Promise<ImageAsset>>();
  function upload(encoded: string): Promise<ImageAsset> {
    const content = Buffer.from(encoded, "base64");
    const digest = createHash("sha256").update(content).digest("hex");
    let pending = uploads.get(digest);
    if (!pending) {
      pending = apiRequest<ImageAsset>("/api/images", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(content).buffer, signal });
      uploads.set(digest, pending);
    }
    return pending;
  }
  async function walk(input: unknown): Promise<unknown> {
    if (Array.isArray(input)) return Promise.all(input.map(walk));
    if (!input || typeof input !== "object") return input;
    const result = Object.fromEntries(await Promise.all(Object.entries(input).map(async ([key, item]) => [key, await walk(item)])));
    if (result.type === "image_url" && result.image_url && typeof result.image_url === "object") {
      const image = result.image_url as Record<string, unknown>;
      const match = typeof image.url === "string" ? /^data:image\/[^;,]+;base64,([\s\S]*)$/.exec(image.url) : null;
      if (match) result.image_url = { ...image, url: (await upload(match[1])).imageRef };
    }
    let encoded: string | undefined;
    let field: string | undefined;
    if (result.contentKind === "image" && typeof result.dataUrl === "string") {
      const match = /^data:image\/[^;,]+;base64,([\s\S]*)$/.exec(result.dataUrl);
      if (match) { encoded = match[1]; field = "dataUrl"; }
    } else if (result.type === "image" && typeof result.data === "string") {
      encoded = result.data; field = "data";
    } else if (typeof result.mimeType === "string" && result.mimeType.startsWith("image/") && typeof result.blob === "string") {
      encoded = result.blob; field = "blob";
    }
    if (encoded !== undefined && field) {
      const asset = await upload(encoded);
      delete result[field];
      Object.assign(result, asset);
    }
    return result;
  }
  return walk(value);
}

export async function previewImageAsset(reference: string): Promise<string> {
  const match = /^ohmycode-image:\/\/[0-9a-f-]{36}\/([0-9a-f]{64})$/.exec(reference);
  if (!match) throw new Error("invalid_image_reference");
  const response = await apiFetch(`/api/images/${match[1]}`);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const content = Buffer.from(await response.arrayBuffer());
  return `data:${response.headers.get("Content-Type")};base64,${content.toString("base64")}`;
}

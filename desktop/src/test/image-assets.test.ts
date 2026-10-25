import { beforeEach, expect, it, vi } from "vitest";
import { storeImages, previewImageAsset } from "../../electron/files/image-assets";
import { createImagePlugin } from "../../electron/runtime/tools/image-plugin";

const api = vi.hoisted(() => ({ apiRequest: vi.fn(), apiFetch: vi.fn(), apiErrorFromResponse: vi.fn() }));
vi.mock("../../electron/api/api-client", () => api);
const reference = `ohmycode-image://00000000-0000-0000-0000-000000000001/${"a".repeat(64)}`;
beforeEach(() => {
  vi.clearAllMocks();
  api.apiRequest.mockResolvedValue({ imageRef: reference, mimeType: "image/png", width: 10, height: 10 });
});

it("截图和 MCP 图片在进入活动记录前上传，同批重复图片只上传一次", async () => {
  const original = { activity: [{ result: { contentKind: "image", dataUrl: "data:image/png;base64,aGVsbG8=" } }, { result: { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }, { type: "resource", resource: { mimeType: "image/png", blob: "aGVsbG8=" } }] } }] };
  const normalized = await storeImages(original);
  expect(api.apiRequest).toHaveBeenCalledOnce();
  expect(JSON.stringify(normalized)).not.toContain("aGVsbG8=");
  expect(JSON.stringify(normalized)).toContain(reference);
  expect(original.activity[0].result.dataUrl).toBe("data:image/png;base64,aGVsbG8=");
  expect(await storeImages(normalized)).toEqual(normalized);
  expect(api.apiRequest).toHaveBeenCalledOnce();
});

it("图片上传失败不回退到持久化 Base64，私有预览通过认证接口读取", async () => {
  api.apiRequest.mockRejectedValueOnce(new Error("object_storage_unavailable"));
  await expect(storeImages({ contentKind: "image", dataUrl: "data:image/png;base64,aGVsbG8=" })).rejects.toThrow("object_storage_unavailable");
  api.apiFetch.mockResolvedValue(new Response("hello", { headers: { "Content-Type": "image/png" } }));
  expect(await previewImageAsset(reference)).toBe("data:image/png;base64,aGVsbG8=");
  expect(api.apiFetch).toHaveBeenCalledWith(`/api/images/${"a".repeat(64)}`);
  await expect(previewImageAsset("https://example.com/image.png")).rejects.toThrow("invalid_image_reference");
});

it("图片工具按私有引用重新附图，保留鉴权且不重新上传图片", async () => {
  api.apiFetch.mockResolvedValueOnce(new Response("hello", { headers: { "Content-Type": "image/png" } }));
  const plugin = createImagePlugin({ projectId: "project" });
  const call = { runId: "run", callId: "view", tool: "view_image", arguments: { imageUrl: reference, detail: "high" } };
  expect(await plugin.execute(call)).toEqual({ callId: "view", result: { contentKind: "image", imageRef: reference, mimeType: "image/png", byteLength: 5, detail: "high" } });
  expect(api.apiFetch).toHaveBeenCalledWith(`/api/images/${"a".repeat(64)}`);
  expect(api.apiRequest).not.toHaveBeenCalled();
  const denied = new Error("not_found");
  api.apiFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  api.apiErrorFromResponse.mockResolvedValueOnce(denied);
  await expect(plugin.execute(call)).rejects.toThrow("not_found");
});

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { previewWorkspaceImage } from "../../electron/files/image-preview";
import { executeViewImage } from "../../electron/files/image-tool";

const { listProjects, getMultiAgentTask } = vi.hoisted(() => ({ listProjects: vi.fn(), getMultiAgentTask: vi.fn() }));
vi.mock("../../electron/projects/projects-service", () => ({ listProjects }));
vi.mock("../../electron/multi-agents/multi-agent-service", () => ({ getMultiAgentTask }));

let root: string | undefined;
let attachmentRoot: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true });
  root = undefined;
  if (attachmentRoot) await rm(attachmentRoot, { recursive: true });
  attachmentRoot = undefined;
});

test("普通会话与协作的本地图片、file URL 使用服务端确认的工作目录", async () => {
  root = await mkdtemp(path.join(tmpdir(), "ohmycode-preview-"));
  const file = path.join(root, "下载.png");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN+kAAAAASUVORK5CYII=", "base64");
  await writeFile(file, image);
  listProjects.mockResolvedValue([{ path: root, conversations: [{ id: "thread" }] }]);
  getMultiAgentTask.mockResolvedValue({ workspacePath: root });
  const expected = `data:image/png;base64,${image.toString("base64")}`;
  expect(await previewWorkspaceImage({ conversationId: "thread" }, "下载.png")).toBe(expected);
  expect(await previewWorkspaceImage({ conversationId: "thread" }, pathToFileURL(file).href)).toBe(expected);
  expect(await previewWorkspaceImage({ taskId: "task" }, file)).toBe(expected);
  await expect(previewWorkspaceImage({ conversationId: "thread" }, "..")).rejects.toThrow("view_image_not_a_file");
  await writeFile(path.join(root, "not-image.txt"), "not an image");
  await expect(previewWorkspaceImage({ conversationId: "thread" }, "not-image.txt")).rejects.toThrow("view_image_not_an_image");
});

test("没有所属工作区不能预览本地图片，接口不代理网络请求", async () => {
  listProjects.mockResolvedValue([]);
  await expect(previewWorkspaceImage({ conversationId: "missing" }, "a.jpg")).rejects.toThrow("workspace_not_found");
  await expect(previewWorkspaceImage({ conversationId: "thread" }, "http://localhost/a.jpg")).rejects.toThrow("local_image_required");
});

test("工作区外图片全局可读，不需要附件授权或工作区查询", async () => {
  root = await mkdtemp(path.join(tmpdir(), "ohmycode-preview-"));
  attachmentRoot = await mkdtemp(path.join(tmpdir(), "ohmycode-attachment-"));
  const allowed = path.join(attachmentRoot, "下载.png");
  const denied = path.join(attachmentRoot, "other.png");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN+kAAAAASUVORK5CYII=", "base64");
  await writeFile(allowed, image);
  await writeFile(denied, image);
  listProjects.mockResolvedValue([{ path: root, conversations: [{ id: "thread" }] }]);
  listProjects.mockClear();
  expect(await previewWorkspaceImage({ conversationId: "thread" }, pathToFileURL(allowed).href)).toBe(`data:image/png;base64,${image.toString("base64")}`);
  expect(await previewWorkspaceImage(undefined, denied)).toBe(`data:image/png;base64,${image.toString("base64")}`);
  expect((await executeViewImage({ projectId: "", imageUrl: path.relative(root, denied) }, root)).dataUrl).toBe(`data:image/png;base64,${image.toString("base64")}`);
  expect(listProjects).not.toHaveBeenCalled();
});

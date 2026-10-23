import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { openLocalPath } from "../../electron/files/open-path";

const mocks = vi.hoisted(() => ({ openPath: vi.fn(), listProjects: vi.fn(), safeExistingPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { openPath: mocks.openPath } }));
vi.mock("../../electron/projects/projects-service", () => ({ listProjects: mocks.listProjects }));
vi.mock("../../electron/files/workspace", () => ({ safeExistingPath: mocks.safeExistingPath }));
beforeEach(() => { vi.clearAllMocks(); mocks.openPath.mockResolvedValue(""); });

it("绝对路径直接打开，相对路径只按对应项目解析", async () => {
  const root = path.resolve("fixture");
  await openLocalPath(root);
  expect(mocks.listProjects).not.toHaveBeenCalled();
  mocks.listProjects.mockResolvedValue([{ id: "project", path: root }]);
  mocks.safeExistingPath.mockResolvedValue(path.join(root, "file.txt"));
  await openLocalPath("file.txt", "project");
  expect(mocks.safeExistingPath).toHaveBeenCalledWith(root, "file.txt");
  expect(mocks.openPath).toHaveBeenLastCalledWith(path.join(root, "file.txt"));
});

it("空路径、项目不存在及系统打开错误仍明确失败", async () => {
  await expect(openLocalPath(" ")).rejects.toThrow("path_required");
  mocks.listProjects.mockResolvedValue([]);
  await expect(openLocalPath("relative", "missing")).rejects.toThrow("project_not_found");
  mocks.openPath.mockResolvedValue("cannot open");
  await expect(openLocalPath(path.resolve("fixture"))).rejects.toThrow("cannot open");
});

import { expect, it, vi } from "vitest";
import { registerApiIpc } from "../../electron/ipc/register-api-ipc";
import { registerFilesIpc } from "../../electron/ipc/register-files-ipc";
import { registerWindowIpc } from "../../electron/ipc/register-window-ipc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  apiRequest: vi.fn(), getApiStatus: vi.fn(), getApiUrl: vi.fn(() => "http://example.test"), setApiUrl: vi.fn(),
  openLocalPath: vi.fn(), previewWorkspaceImage: vi.fn(), savePastedImage: vi.fn(), fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
    on: (channel: string, listener: (...args: unknown[]) => unknown) => mocks.listeners.set(channel, listener),
  },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));
vi.mock("../../electron/api/api-client", () => ({ apiRequest: mocks.apiRequest, getApiStatus: mocks.getApiStatus }));
vi.mock("../../electron/config", () => ({ getApiUrl: mocks.getApiUrl, setApiUrl: mocks.setApiUrl }));
vi.mock("../../electron/files/open-path", () => ({ openLocalPath: mocks.openLocalPath }));
vi.mock("../../electron/files/image-preview", () => ({ previewWorkspaceImage: mocks.previewWorkspaceImage }));
vi.mock("../../electron/files/pasted-image", () => ({ savePastedImage: mocks.savePastedImage }));

it("API、文件和窗口 IPC 将操作交给对应服务及发送方窗口", async () => {
  registerApiIpc(); registerFilesIpc(); registerWindowIpc();
  mocks.getApiStatus.mockResolvedValue({ online: true, url: "http://example.test" });
  expect(await mocks.handlers.get("api:status")!()).toEqual({ online: true, url: "http://example.test" });
  expect(mocks.handlers.get("debug:get-config")!()).toEqual({ apiUrl: "http://example.test" });
  mocks.setApiUrl.mockReturnValue("http://new.test");
  expect(mocks.handlers.get("debug:set-api-url")!(null, "http://new.test")).toEqual({ apiUrl: "http://new.test" });
  mocks.handlers.get("debug:context-snapshot")!(null, "thread");
  expect(mocks.apiRequest).toHaveBeenCalledWith("/api/projects/conversations/thread/context-snapshot");
  mocks.handlers.get("images:preview")!(null, { taskId: "task" }, "image.png");
  expect(mocks.previewWorkspaceImage).toHaveBeenCalledWith({ taskId: "task" }, "image.png");
  mocks.handlers.get("system:open-path")!(null, "file.txt", "project");
  expect(mocks.openLocalPath).toHaveBeenCalledWith("file.txt", "project");
  const data = new Uint8Array([1, 2]);
  mocks.handlers.get("conversations:save-pasted-image")!(null, data);
  expect(mocks.savePastedImage).toHaveBeenCalledWith(data);
  const sender = {};
  const window = { close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), isMaximized: vi.fn(() => false), webContents: { openDevTools: vi.fn() } };
  mocks.fromWebContents.mockReturnValue(window);
  mocks.listeners.get("window:close")!({ sender });
  mocks.listeners.get("window:minimize")!({ sender });
  mocks.listeners.get("window:toggle-maximize")!({ sender });
  window.isMaximized.mockReturnValue(true);
  mocks.listeners.get("window:toggle-maximize")!({ sender });
  mocks.listeners.get("debug:open-devtools")!({ sender });
  expect(window.close).toHaveBeenCalledOnce();
  expect(window.minimize).toHaveBeenCalledOnce();
  expect(window.maximize).toHaveBeenCalledOnce();
  expect(window.unmaximize).toHaveBeenCalledOnce();
  expect(window.webContents.openDevTools).toHaveBeenCalledWith({ mode: "detach" });
  expect(mocks.fromWebContents).toHaveBeenCalledWith(sender);
});

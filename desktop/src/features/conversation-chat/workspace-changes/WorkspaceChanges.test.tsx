import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { WorkspaceChanges } from "./WorkspaceChanges";
import { FeedbackProvider } from "../../feedback";
import { useState } from "react";
import { useWorkspaceChanges } from "./useWorkspaceChanges";
import { WorkspaceChangesButton } from "./WorkspaceChangesButton";

vi.mock("../activity-timeline/file-diff-viewer/FileDiffViewer", () => ({ FileDiffViewer: () => <div>File diff</div> }));

const record = {
  id: "snapshot", threadId: "thread", turnId: "turn", userRequest: "Fix the conversation layout without changing file restoration behavior", createdAt: "2026-11-16T00:00:00Z", status: "ready" as const,
  files: [{ path: "src/demo.ts", operation: "modified" as const }], excluded: [".env"],
};

function Harness({ sending }: { sending: boolean }) {
  const [opened, setOpened] = useState(false);
  const changes = useWorkspaceChanges("thread", sending, true);
  return <>{changes.hasChanges && <WorkspaceChangesButton opened={opened} onClick={() => setOpened((value) => !value)} />}{opened && changes.hasChanges && <WorkspaceChanges conversationId="thread" sending={sending} records={changes.records} failed={changes.failed} refresh={changes.refresh} active onClose={() => setOpened(false)} />}</>;
}

async function setup(restoreFile = vi.fn(async () => {}), sending = false) {
  const snapshots = vi.fn(async () => [record]);
  const snapshotDetail = vi.fn(async () => ({ path: "src/demo.ts", original: "before", modified: "after" }));
  const restoreTurn = vi.fn(async () => {});
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: { snapshots, snapshotDetail, restoreFile, restoreTurn }, windowControls: { reservePanelSpace: async () => 1200 } } });
  render(<FeedbackProvider><Harness sending={sending} /></FeedbackProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Workspace changes" }));
  return { snapshots, snapshotDetail, restoreFile, restoreTurn };
}

test("reviews a selected file and confirms restoration through the narrow bridge", async () => {
  const bridge = await setup();
  fireEvent.click(await screen.findByRole("button", { name: "src/demo.ts" }));
  await screen.findByText("File diff");
  expect(bridge.snapshotDetail).toHaveBeenCalledWith("thread", "snapshot", "src/demo.ts");
  fireEvent.click(screen.getByRole("button", { name: "Restore file: src/demo.ts" }));
  expect(bridge.restoreFile).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(dialog.querySelector("footer button:last-child")!);
  await waitFor(() => expect(bridge.restoreFile).toHaveBeenCalledWith("thread", "snapshot", "src/demo.ts"));
  await screen.findByText("Restored");
});

test("running turns disable restore and exclusions explain their meaning", async () => {
  await setup(vi.fn(async () => {}), true);
  await screen.findByRole("button", { name: "src/demo.ts" });
  expect(screen.getByRole("button", { name: "Restore file: src/demo.ts" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Excluded from snapshots (1)")).toBeTruthy();
  expect(screen.getByText(/This count does not mean these files were modified/)).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "Workspace changes" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("failed restoration keeps confirmation available and shows a useful error", async () => {
  await setup(vi.fn(async () => { throw new Error("snapshot_conflict"); }));
  await screen.findByRole("button", { name: "src/demo.ts" });
  fireEvent.click(screen.getByRole("button", { name: "Restore file: src/demo.ts" }));
  fireEvent.click(screen.getByRole("alertdialog").querySelector("footer button:last-child")!);
  await screen.findByText(/Cannot restore: the file changed/);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
});

test("hides the entry when snapshots contain only excluded files or all changes were restored", async () => {
  const snapshots = vi.fn<DesktopBridge["conversations"]["snapshots"]>(async () => [{ ...record, files: [] }]);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: { snapshots } } });
  const view = render(<FeedbackProvider><Harness sending={false} /></FeedbackProvider>);
  await waitFor(() => expect(snapshots).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Workspace changes" })).toBeNull();
  snapshots.mockResolvedValue([{ ...record, files: [{ ...record.files[0], restored: true }] }]);
  view.rerender(<FeedbackProvider><Harness sending /></FeedbackProvider>);
  await waitFor(() => expect(snapshots).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", { name: "Workspace changes" })).toBeNull();
});

test("the header entry uses the shared tooltip", async () => {
  await setup();
  const button = screen.getByRole("button", { name: "Workspace changes" });
  fireEvent.mouseEnter(button.parentElement!);
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", "Workspace changes");
});

test("shows the original request beside time, with a full-text tooltip and confirmed Turn restore", async () => {
  const bridge = await setup();
  const request = screen.getByText(record.userRequest);
  expect(request.parentElement?.parentElement?.querySelector("time")?.getAttribute("datetime")).toBe(record.createdAt);
  fireEvent.mouseEnter(request.parentElement!);
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", record.userRequest);
  fireEvent.mouseLeave(request.parentElement!);
  fireEvent.click(screen.getByRole("button", { name: `Restore all: ${record.userRequest}` }));
  expect(bridge.restoreTurn).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.textContent).toContain("1 remaining files changed in this turn");
  fireEvent.click(dialog.querySelector("footer button:last-child")!);
  await waitFor(() => expect(bridge.restoreTurn).toHaveBeenCalledWith("thread", "snapshot"));
  expect(bridge.restoreFile).not.toHaveBeenCalled();
});

test("files open separate cached tabs, use A/M/D codes and omit the ready label and description", async () => {
  const snapshots = vi.fn(async () => [{ ...record, files: [...record.files, { path: "src/new.ts", operation: "added" }, { path: "src/old.ts", operation: "deleted" }] }]);
  const snapshotDetail = vi.fn(async (_id: string, _snapshotId: string, file: string) => ({ path: file, original: "before", modified: "after" }));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: { snapshots, snapshotDetail }, windowControls: { reservePanelSpace: async () => 1200 } } });
  render(<FeedbackProvider><Harness sending={false} /></FeedbackProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Workspace changes" }));
  for (const code of ["A", "M", "D"]) expect(screen.getByText(code, { exact: true })).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.queryByText(/Select a file to review/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "src/demo.ts" }));
  await screen.findByText("File diff");
  fireEvent.click(screen.getByRole("button", { name: "src/new.ts" }));
  await waitFor(() => expect(snapshotDetail).toHaveBeenCalledTimes(2));
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  fireEvent.click(screen.getByRole("tab", { name: "demo.ts" }));
  expect(screen.getByRole("tab", { name: "demo.ts" }).getAttribute("aria-selected")).toBe("true");
  expect(snapshotDetail).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Close file: src/demo.ts" }));
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.getByRole("tab", { name: "new.ts" }).getAttribute("aria-selected")).toBe("true");
});

import { app, BrowserWindow, net, type WebContents } from "electron";
import path from "node:path";
import { ensureVideoServer, type AndroidTouch } from "@ohmycode/android-use";
import { androidHost, getAndroidState } from "./android-service.js";
import { createApplicationWindow } from "../window/create-main-window.js";

let detached: BrowserWindow | undefined;
let detaching: Promise<void> | undefined;
let viewer: { sender: WebContents; id: string; abort: AbortController; close?: () => Promise<void> } | undefined;

function publish() {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("android:detached", Boolean(detached));
}
export const androidDetached = () => Boolean(detached);

export function touchAndroid(sender: WebContents, conversationId: string, events: AndroidTouch[]): void {
  if (viewer?.sender !== sender) throw new Error("android_video_not_connected");
  androidHost().touch(conversationId, events);
}

export async function setAndroidDetached(owner: BrowserWindow, value: boolean): Promise<void> {
  if (detaching) await detaching;
  if (!value) { detached?.close(); return; }
  if (detached) { detached.show(); detached.focus(); return; }
  detaching = (async () => {
    const window = await createApplicationWindow({ width: 760, height: 880, minWidth: 360, show: false }, "/android", (window) => {
      detached = window;
      const close = () => { if (!window.isDestroyed()) window.destroy(); };
      owner.once("closed", close);
      window.once("closed", () => { detached = undefined; owner.removeListener("closed", close); publish(); });
    });
    if (!window.isDestroyed()) window.show();
    publish();
  })().finally(() => { detaching = undefined; });
  await detaching;
}

export async function stopAndroidVideo(sender: WebContents, id: string): Promise<void> {
  if (viewer?.sender !== sender || viewer.id !== id) return;
  const current = viewer; viewer = undefined;
  current.abort.abort();
  await current.close?.();
}

export async function startAndroidVideo(sender: WebContents, id: string): Promise<void> {
  const state = await getAndroidState();
  if (!state.enabled || !state.installed || state.phase !== "running") throw new Error("android_not_running");
  const previous = viewer;
  const current = { sender, id, abort: new AbortController(), close: undefined as (() => Promise<void>) | undefined };
  viewer = current;
  if (previous) { previous.abort.abort(); await previous.close?.(); }
  const destroyed = () => { void stopAndroidVideo(sender, id); };
  sender.once("destroyed", destroyed);
  const fail = () => {
    if (!current.abort.signal.aborted && !sender.isDestroyed()) sender.send("android:video", id, { error: "android_video_failed" });
    void stopAndroidVideo(sender, id);
  };
  try {
    const server = await ensureVideoServer(path.join(app.getPath("userData"), "android", "video"), net.fetch as typeof fetch, current.abort.signal);
    current.abort.signal.throwIfAborted();
    current.close = await androidHost().openVideo(server, (packet) => {
      if (!current.abort.signal.aborted && !sender.isDestroyed()) sender.send("android:video", id, packet);
    }, fail, current.abort.signal);
    if (current.abort.signal.aborted) await current.close();
  } catch (error) {
    if (!current.abort.signal.aborted) { fail(); throw error; }
  }
  finally {
    if (current.abort.signal.aborted) sender.removeListener("destroyed", destroyed);
    else current.abort.signal.addEventListener("abort", () => sender.removeListener("destroyed", destroyed), { once: true });
  }
}

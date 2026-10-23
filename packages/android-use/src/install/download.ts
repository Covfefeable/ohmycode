import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RuntimeComponent } from "./manifest.js";

export type RuntimeFetch = (url: string, init?: RequestInit) => Promise<Response>;
export async function verifiedArchive(file: string, component: RuntimeComponent, signal: AbortSignal): Promise<boolean> {
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!info || info.size !== component.bytes) return false;
  const hash = createHash("sha1");
  const input = createReadStream(file, { signal });
  for await (const chunk of input) hash.update(chunk);
  return hash.digest("hex") === component.sha1;
}

/** Stream directly to disk. A slow transfer is allowed; a stalled transfer is not. */
export async function downloadArchive(component: RuntimeComponent, file: string, signal: AbortSignal, fetcher: RuntimeFetch, progress: (received: number) => void): Promise<void> {
  const partial = `${file}.part`;
  const idle = new AbortController();
  const requestSignal = AbortSignal.any([signal, idle.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), 60_000); };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let received = 0;
  const hash = createHash("sha1");
  try {
    resetTimeout();
    const response = await fetcher(component.url, { signal: requestSignal });
    if (!response.ok || !response.body) throw new Error("android_install_download_failed");
    reader = response.body.getReader();
    const chunks = async function* () {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        resetTimeout();
        received += value.byteLength;
        if (received > component.bytes) throw new Error("android_install_checksum_failed");
        hash.update(value);
        progress(received);
        yield value;
      }
    };
    await pipeline(Readable.from(chunks()), createWriteStream(partial, { flags: "w" }), { signal: requestSignal });
    if (received !== component.bytes || hash.digest("hex") !== component.sha1) throw new Error("android_install_checksum_failed");
    signal.throwIfAborted();
    await rename(partial, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (signal.aborted || code === "ENOSPC" || code === "EACCES" || code === "EPERM" || error instanceof Error && error.message.startsWith("android_install_")) throw error;
    throw new Error("android_install_download_failed", { cause: error });
  } finally {
    clearTimeout(timer!);
    await reader?.cancel().catch(() => undefined);
    await rm(partial, { force: true });
  }
}

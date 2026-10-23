import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export const SCRCPY_VERSION = "3.3.4";
const digest = "8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e";
const valid = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex") === digest;

/** Official device-side server only (91 KB), not the desktop scrcpy distribution. */
export async function ensureVideoServer(root: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const file = path.join(root, `scrcpy-server-${SCRCPY_VERSION}.jar`);
  try { if (valid(await readFile(file))) return file; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const response = await fetcher(`https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  if (!response.ok) throw new Error("android_video_download_failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error("android_video_checksum_failed");
  signal.throwIfAborted();
  await mkdir(root, { recursive: true });
  const temporary = `${file}.part`;
  try { await writeFile(temporary, bytes); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
  return file;
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Open } from "unzipper";

// Official PyPI wheel, pinned to the version verified on MuMu. No Python runtime is used.
export const UIAUTOMATOR_VERSION = "3.7.1";
const wheelUrl = "https://files.pythonhosted.org/packages/25/da/0855f5a80cb43a1b83085df91c4b82078f6dfefe3e4bf24be8b0372f7a24/uiautomator2-3.7.1-py3-none-any.whl";
const wheelHash = "55ccc16f7c52d3035dbc14e1400524e76510dc353f9fc4a0bfa85bf58c51cc67";
const jarHash = "87c8ac9505970d42aa5922baa90114808fda6f47f9e5fbd4caa0f621c2c8d30d";
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export async function ensureAutomationServer(root: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const file = path.join(root, `uiautomator-${UIAUTOMATOR_VERSION}.jar`);
  try { if (hash(await readFile(file)) === jarHash) return file; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const response = await fetcher(wheelUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  if (!response.ok) throw new Error("android_automation_download_failed");
  const wheel = Buffer.from(await response.arrayBuffer());
  if (hash(wheel) !== wheelHash) throw new Error("android_automation_checksum_failed");
  const entry = (await Open.buffer(wheel)).files.find((entry) => entry.path === "uiautomator2/assets/u2.jar");
  if (!entry) throw new Error("android_automation_checksum_failed");
  const jar = await entry.buffer();
  if (hash(jar) !== jarHash) throw new Error("android_automation_checksum_failed");
  signal.throwIfAborted();
  await mkdir(root, { recursive: true });
  const temporary = `${file}.${randomUUID()}.part`;
  try { await writeFile(temporary, jar); signal.throwIfAborted(); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
  return file;
}

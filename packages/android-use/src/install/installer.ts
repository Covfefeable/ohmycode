import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadArchive, verifiedArchive, type RuntimeFetch } from "./download.js";
import { extractArchive } from "./extract.js";
import { REQUIRED_FREE_BYTES, type RuntimeComponent } from "./manifest.js";

const receiptName = ".ohmycode-component.json";
export type InstallProgress = {
  phase: "checking" | "downloading" | "verifying" | "extracting" | "finishing";
  component?: RuntimeComponent["id"];
  receivedBytes: number;
  totalBytes: number;
};

async function receipt(directory: string): Promise<{ id: string; sha1: string } | undefined> {
  try { return JSON.parse(await readFile(path.join(directory, receiptName), "utf8")) as { id: string; sha1: string }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("android_install_conflict", { cause: error }); }
}
async function filesPresent(directory: string, component: RuntimeComponent): Promise<boolean> {
  return (await Promise.all(component.requiredFiles.map((file) => stat(path.join(directory, file)).then((info) => info.isFile(), () => false)))).every(Boolean);
}

async function publishComponent(staging: string, destination: string, component: RuntimeComponent): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const exists = await stat(destination).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
  const previous = `${destination}.previous-${randomUUID()}`;
  if (exists) {
    if ((await receipt(destination))?.id !== component.id) throw new Error("android_install_conflict");
    await rename(destination, previous);
  }
  try { await rename(staging, destination); }
  catch (error) { if (exists) await rename(previous, destination); throw error; }
  if (exists) await rm(previous, { recursive: true, force: true });
}

export async function installRuntime(options: {
  root: string;
  components: RuntimeComponent[];
  signal: AbortSignal;
  onProgress(progress: InstallProgress): void;
  fetcher?: RuntimeFetch;
  requiredFreeBytes?: number;
}): Promise<string> {
  const { root, components, signal, onProgress } = options;
  const sdk = path.join(root, "sdk");
  const downloads = path.join(root, "downloads");
  const totalBytes = components.reduce((sum, item) => sum + item.bytes, 0);
  let completed = 0;
  const emit = (phase: InstallProgress["phase"], component?: RuntimeComponent["id"], received = 0) => onProgress({ phase, component, receivedBytes: completed + received, totalBytes });
  signal.throwIfAborted();
  emit("checking");
  await mkdir(root, { recursive: true });
  const reusable = new Set<string>();
  for (const component of components) {
    const target = path.join(sdk, component.destination);
    const installed = await receipt(target);
    if (installed?.id === component.id && installed.sha1 === component.sha1 && await filesPresent(target, component)) reusable.add(component.id);
    else if (await stat(target).then(() => true, () => false) && installed?.id !== component.id) throw new Error("android_install_conflict");
  }
  if (reusable.size !== components.length) {
    const disk = await statfs(root);
    if (disk.bavail * disk.bsize < (options.requiredFreeBytes ?? REQUIRED_FREE_BYTES)) throw new Error("android_install_disk_space");
  }
  await mkdir(downloads, { recursive: true });
  for (const component of components) {
    signal.throwIfAborted();
    const target = path.join(sdk, component.destination);
    if (reusable.has(component.id)) {
      completed += component.bytes;
      emit("checking", component.id);
      continue;
    }
    const archive = path.join(downloads, `${component.id}-${component.sha1}.zip`);
    emit("verifying", component.id);
    if (!(await verifiedArchive(archive, component, signal))) {
      emit("downloading", component.id);
      let reportedAt = 0;
      await downloadArchive(component, archive, signal, options.fetcher ?? fetch, (received) => {
        if (Date.now() - reportedAt >= 150 || received === component.bytes) { reportedAt = Date.now(); emit("downloading", component.id, received); }
      });
    }
    emit("extracting", component.id, component.bytes);
    const staging = await mkdtemp(path.join(downloads, "extract-"));
    try {
      await extractArchive(archive, staging, component.archiveRoot, signal);
      if (!(await filesPresent(staging, component))) throw new Error("android_install_incomplete_archive");
      await writeFile(path.join(staging, receiptName), JSON.stringify({ id: component.id, sha1: component.sha1, version: component.version }));
      signal.throwIfAborted();
      await publishComponent(staging, target, component);
    } finally { await rm(staging, { recursive: true, force: true }); }
    await rm(archive, { force: true });
    completed += component.bytes;
  }
  emit("finishing");
  return sdk;
}

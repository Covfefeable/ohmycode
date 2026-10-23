import { createWriteStream } from "node:fs";
import { chmod, mkdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Open } from "unzipper";

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Extract into a fresh staging directory; never apply DOS read-only attributes/ACLs. */
export async function extractArchive(archive: string, destination: string, archiveRoot: string, signal: AbortSignal): Promise<void> {
  const directory = await Open.file(archive);
  const links: { file: string; target: string }[] = [];
  for (const entry of directory.files) {
    signal.throwIfAborted();
    const name = entry.path.replaceAll("\\", "/");
    if (name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) throw new Error("android_install_unsafe_archive");
    if (!name.startsWith(`${archiveRoot}/`)) continue;
    const relative = name.slice(archiveRoot.length + 1);
    if (!relative) continue;
    const target = path.resolve(destination, relative);
    if (!inside(destination, target)) throw new Error("android_install_unsafe_archive");
    const mode = entry.externalFileAttributes >>> 16;
    if (entry.type === "Directory") { await mkdir(target, { recursive: true }); continue; }
    await mkdir(path.dirname(target), { recursive: true });
    if ((mode & 0o170000) === 0o120000) {
      if (entry.uncompressedSize > 4096) throw new Error("android_install_unsafe_archive");
      const link = (await entry.buffer()).toString();
      if (path.isAbsolute(link) || !inside(destination, path.resolve(path.dirname(target), link))) throw new Error("android_install_unsafe_archive");
      links.push({ file: target, target: link });
    } else {
      await pipeline(entry.stream(), createWriteStream(target, { flags: "wx" }), { signal });
      if (process.platform !== "win32") await chmod(target, (mode & 0o777) | 0o600);
    }
  }
  // Create links last: no subsequent file write can traverse an archive-provided symlink.
  for (const link of links) { signal.throwIfAborted(); await symlink(link.target, link.file); }
  for (const link of links) if (!inside(destination, await realpath(link.file))) throw new Error("android_install_unsafe_archive");
}

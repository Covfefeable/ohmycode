import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;

export function readSkillArchive(archive: Uint8Array): Record<string, Uint8Array> {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("skill_archive_too_large");
  let count = 0;
  let total = 0;
  const paths = new Set<string>();
  // fflate calls filter before allocating the declared output buffer or inflating it.
  return unzipSync(archive, { filter(entry) {
    const name = entry.name.replaceAll("\\", "/");
    if (name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) {
      throw new Error("invalid_skill_archive_path");
    }
    if (name.endsWith("/")) return false;
    if (paths.has(name)) throw new Error("invalid_skill_archive_path");
    paths.add(name);
    count += 1;
    if (count > MAX_FILES) throw new Error("invalid_skill_archive");
    total += Math.max(entry.originalSize, entry.size);
    if (total > MAX_EXTRACTED_BYTES) throw new Error("skill_extracted_too_large");
    return true;
  } });
}

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readSkillArchive } from "../../electron/capabilities/skill-archive";

describe("Skill archive limits", () => {
  it("reads a normal archive", () => {
    const archive = zipSync({ "demo/SKILL.md": strToU8("# Demo") });
    expect(new TextDecoder().decode(readSkillArchive(archive)["demo/SKILL.md"])).toBe("# Demo");
  });

  it("rejects excessive declared output before allocating or inflating it", () => {
    const archive = zipSync({ "SKILL.md": strToU8("# Demo") });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const centralDirectory = view.getUint32(archive.length - 22 + 16, true);
    view.setUint32(centralDirectory + 24, 1024 * 1024 * 1024, true);
    expect(() => readSkillArchive(archive)).toThrow("skill_extracted_too_large");
  });

  it.each(["../SKILL.md", "C:/SKILL.md", "/SKILL.md", "a\\..\\SKILL.md"])("rejects unsafe path %s", (name) => {
    expect(() => readSkillArchive(zipSync({ [name]: strToU8("# Demo") }))).toThrow("invalid_skill_archive_path");
  });

  it("rejects too many entries", () => {
    const entries = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`${index}.md`, strToU8("x")]));
    expect(() => readSkillArchive(zipSync(entries))).toThrow("invalid_skill_archive");
  });
});

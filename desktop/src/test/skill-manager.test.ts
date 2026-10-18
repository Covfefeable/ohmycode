import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "", selected: "", request: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => mocks.root }, dialog: { showOpenDialog: async () => ({ filePaths: [mocks.selected] }) } }));
vi.mock("../../electron/api/api-client.js", () => ({ apiRequest: mocks.request, apiFetch: vi.fn() }));
import { installSkill, listSkills, loadSkillInstructions, removeLocalSkill } from "../../electron/capabilities/skill-manager";

afterEach(async () => { if (mocks.root) await rm(mocks.root, { recursive: true, force: true }); });

it("keeps Chinese and normalized-colliding names in independent ID directories", async () => {
  mocks.root = await mkdtemp(path.join(os.tmpdir(), "ohmycode-skills-"));
  mocks.selected = path.join(mocks.root, "upload.zip");
  const records = [];
  for (const [id, name] of [["id-a", "中文技能"], ["id-b", "另一个技能"]]) {
    await writeFile(mocks.selected, zipSync({ "SKILL.md": strToU8(`# ${name}`) }));
    mocks.request.mockResolvedValueOnce({ id, name, enabled: true });
    records.push(await installSkill());
    expect(await loadSkillInstructions(id)).toBe(`# ${name}`);
  }
  mocks.request.mockResolvedValueOnce({ skills: records });
  expect((await listSkills()).map((skill) => skill.installed)).toEqual([true, true]);
  await removeLocalSkill("id-a");
  await expect(loadSkillInstructions("id-a")).rejects.toThrow();
  expect(await loadSkillInstructions("id-b")).toBe("# 另一个技能");
  // The installer must not remove files outside its ID directory.
  expect((await readFile(mocks.selected)).length).toBeGreaterThan(0);
});

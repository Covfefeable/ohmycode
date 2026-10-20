import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-package-boundaries.mjs", import.meta.url));

async function check(packages) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ohmycode-boundaries-"));
  try {
    for (const item of packages) {
      const directory = path.join(root, "packages", item.name);
      await mkdir(path.join(directory, "src"), { recursive: true });
      await writeFile(path.join(directory, "package.json"), JSON.stringify({
        name: `@test/${item.name}`, ...(item.platform ? { ohmycode: { platform: item.platform } } : {}),
      }));
      await writeFile(path.join(directory, "src", "index.ts"), item.source);
    }
    try {
      return { ok: true, output: execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: "pipe" }) };
    } catch (error) {
      return { ok: false, output: error.stderr.toString() };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("明确声明 Electron 平台的公共包可以依赖 Electron 和 Node", async () => {
  assert.equal((await check([{ name: "browser", platform: "electron", source: 'import { app } from "electron"; import path from "node:path";' }])).ok, true);
});

test("默认平台无关包仍禁止 Electron、Node 和移动端专用依赖", async () => {
  for (const dependency of ["electron", "node:fs", "fs", "react-native", "expo-av", "@expo/vector-icons"]) {
    const result = await check([{ name: "runtime", source: `import value from "${dependency}";` }]);
    assert.equal(result.ok, false, dependency);
    assert.match(result.output, /boundary violations/);
  }
});

test("平台无关包不能通过包名、子路径或相对路径引用平台相关公共包", async () => {
  for (const dependency of ["@test/browser", "@test/browser/main", "../../browser/src/index.js"]) {
    const result = await check([
      { name: "browser", platform: "electron", source: "export const value = 1;" },
      { name: "runtime", source: `import { value } from "${dependency}";` },
    ]);
    assert.equal(result.ok, false, dependency);
  }
});

test("平台相关包也不能依赖应用目录或者其他平台", async () => {
  for (const dependency of ["../../../desktop/main.js", "../../../mobile/app.js", "../../../api/app.js", "react-native", "@expo/vector-icons"]) {
    assert.equal((await check([{ name: "browser", platform: "electron", source: `import value from "${dependency}";` }])).ok, false, dependency);
  }
});

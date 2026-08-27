import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const forbiddenPackages = /^(electron|react-native|expo(?:-|$)|node:)/;
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
const violations = [];

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sourceRoot = path.join(packagesRoot, entry.name, "src");
  let files = [];
  try {
    files = await sourceFiles(sourceRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      const resolved = specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : "";
      const importsApplication =
        resolved.includes(`${path.sep}desktop${path.sep}`) ||
        resolved.includes(`${path.sep}mobile${path.sep}`);
      if (forbiddenPackages.test(specifier) || importsApplication) {
        violations.push(`${path.relative(root, file)} imports ${specifier}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Shared package boundary violations:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Shared package boundaries passed");
}

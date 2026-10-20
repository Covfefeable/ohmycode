import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "release/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.ts", "test/**/*.mjs"], languageOptions: { globals: globals.node } },
  { files: ["test/**/*.cjs"], languageOptions: { globals: globals.node }, rules: { "@typescript-eslint/no-require-imports": "off" } },
);

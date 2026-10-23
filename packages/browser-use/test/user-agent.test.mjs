import assert from "node:assert/strict";
import test from "node:test";
import { browserUserAgent } from "../dist/user-agent.js";

test("browser UA preserves the actual platform and Chromium version, without application/Electron products", () => {
  for (const platform of ["Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7", "X11; Linux x86_64"]) {
    for (const name of ["OhMyCode", "@ohmycode/desktop", "Browser Agent Fixture", "App.With+Regex(Characters)"]) {
      const prefix = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko)`;
      const chrome = `${prefix} Chrome/150.0.1234.56 Safari/537.36`;
      const electron = `${prefix} ${name.replaceAll(" ", "")}/1.0.1 Chrome/150.0.1234.56 Electron/43.4.1 Safari/537.36`;
      assert.equal(browserUserAgent(electron, name), chrome);
      assert.equal(browserUserAgent(chrome, name), chrome);
    }
  }
});

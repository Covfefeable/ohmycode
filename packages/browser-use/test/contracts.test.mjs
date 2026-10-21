import assert from "node:assert/strict";
import test from "node:test";
import { browserUrl, fitBounds } from "../dist/types.js";
import { BROWSER_TOOL_DEFINITIONS } from "../dist/definitions.js";

test("navigation accepts HTTP(S) and a blank page, never local files or privileged protocols", () => {
  assert.equal(browserUrl("https://example.com"), "https://example.com/");
  assert.equal(browserUrl("http://localhost:5173/path"), "http://localhost:5173/path");
  assert.equal(browserUrl("about:blank"), "about:blank");
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "data:text/html,hello", "invalid"]) assert.throws(() => browserUrl(value));
});

test("native page bounds cannot cover space outside the content area", () => {
  assert.deepEqual(fitBounds({ x: -10, y: 60.2, width: 1000, height: 900 }, [800, 600]), { x: 0, y: 60, width: 800, height: 540 });
  assert.deepEqual(fitBounds({ x: 900, y: 700, width: 100, height: 100 }, [800, 600]), { x: 800, y: 600, width: 0, height: 0 });
});

test("browser schemas are unique, upfront function definitions with strict property lists", () => {
  assert.equal(new Set(BROWSER_TOOL_DEFINITIONS.map((tool) => tool.name)).size, 9);
  for (const tool of BROWSER_TOOL_DEFINITIONS) {
    assert.ok(tool.description.length > 30);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

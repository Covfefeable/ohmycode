import assert from "node:assert/strict";
import test from "node:test";
import { pressKey } from "../dist/page-input.js";

test("keyboard events carry native editing commands on macOS only", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  t.after(() => Object.defineProperty(process, "platform", platform));
  const events = [];
  const page = { debugger: { async sendCommand(method, event) { events.push({ method, ...event }); } } };
  for (const os of ["darwin", "win32", "linux"]) {
    Object.defineProperty(process, "platform", { ...platform, value: os });
    for (const [key, command] of [["Meta+a", "selectAll"], ["Meta+c", "copy"], ["Meta+x", "cut"], ["Meta+v", "paste"], ["Meta+z", "undo"], ["Shift+Meta+Z", "redo"]]) {
      events.length = 0;
      await pressKey(page, key);
      assert.equal(events.length, 2);
      assert.deepEqual(events[0].commands, os === "darwin" ? [command] : undefined);
      assert.equal(events[0].text, undefined);
      assert.equal(events[1].type, "keyUp");
      assert.equal(events[1].commands, undefined);
    }
    events.length = 0;
    await pressKey(page, "Control+a");
    assert.equal(events[0].modifiers, 2);
    assert.equal(events[0].commands, undefined);
    await pressKey(page, "a");
    assert.equal(events[2].text, "a");
    await assert.rejects(pressKey(page, "Hyper+a"), /browser_invalid_modifier/);
  }
});

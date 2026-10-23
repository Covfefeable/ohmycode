const assert = require("node:assert/strict");

module.exports = async function consoleDiagnostics(host, base) {
  const id = "console";
  await host.command(id, { action: "new", url: base });
  await host.execute(id, "browser_evaluate", { expression: "(() => { console.warn('fixture warning'); console.log({answer:42}); setTimeout(() => {throw new Error('fixture uncaught')}, 0); return true; })()" });
  const deadline = Date.now() + 3000;
  let errors;
  do {
    errors = await host.execute(id, "browser_console", { level: "error" });
    if (errors.entries.some((entry) => entry.kind === "exception" && entry.text.includes("fixture uncaught"))) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(errors.entries.some((entry) => entry.kind === "exception" && entry.text.includes("fixture uncaught")), true);
  const warning = await host.execute(id, "browser_console", { level: "warning" });
  assert.equal(warning.entries.some((entry) => entry.text === "fixture warning"), true);
  const first = await host.execute(id, "browser_console", { limit: 1 });
  const next = await host.execute(id, "browser_console", { after: first.nextCursor });
  assert.equal(next.entries.every((entry) => entry.sequence > first.nextCursor), true);
  await host.command(id, { action: "new", url: base });
  const selected = host.state(id).selectedId;
  const other = await host.execute(id, "browser_console", {});
  assert.equal(other.entries.some((entry) => entry.text.includes("fixture")), false);
  await host.command(id, { action: "close", tabId: selected });
  assert.equal((await host.execute(id, "browser_console", {})).entries.some((entry) => entry.text === "fixture warning"), true);
  host.closeSession(id);
};

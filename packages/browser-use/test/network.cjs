const assert = require("node:assert/strict");

module.exports = {
  respond(request, response) {
    if (!request.url.startsWith("/network-")) return false;
    if (request.url === "/network-fail") { request.socket.destroy(); return true; }
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Set-Cookie", "test=fixture-secret; HttpOnly");
    response.statusCode = request.url === "/network-error" ? 500 : 200;
    response.end(JSON.stringify({ message: "network fixture" }));
    return true;
  },
  async test(host, base) {
    const id = "network";
    await host.command(id, { action: "new", url: base });
    await host.execute(id, "browser_evaluate", { expression: "Promise.all([fetch('/network-text?api_key=fixture-secret', {headers: {Authorization: 'Bearer fixture-secret'}}).then(r=>r.text()), fetch('/network-error').then(r=>r.text()), fetch('/network-fail').catch(()=>null)]).then(()=>true)" });
    const list = await host.execute(id, "browser_network", { action: "list", url: "/network-" });
    assert.equal(list.requests.length >= 3, true);
    const success = list.requests.find((item) => item.url.includes("/network-text"));
    assert.equal(success.status, 200);
    const detail = await host.execute(id, "browser_network", { action: "detail", requestId: success.id });
    assert.equal(JSON.stringify(detail).includes("fixture-secret"), false);
    const body = await host.execute(id, "browser_network", { action: "body", requestId: success.id });
    assert.equal(JSON.parse(body.body).message, "network fixture");
    const failed = await host.execute(id, "browser_network", { action: "list", failedOnly: true });
    assert.equal(failed.requests.some((item) => item.status === 500), true);
    assert.equal(failed.requests.some((item) => item.error), true);
    await host.command("network-other", { action: "new", url: base });
    await assert.rejects(host.execute("network-other", "browser_network", { action: "detail", requestId: success.id }), /browser_request_not_found/);
    host.closeSession(id);
    await assert.rejects(host.execute(id, "browser_network", { action: "list" }), /browser_tab_not_found/);
    host.closeSession("network-other");
  },
};

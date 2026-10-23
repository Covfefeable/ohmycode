const assert = require("node:assert/strict");
const { app, session } = require("electron");

module.exports = {
  respond(request, response) {
    if (request.url !== "/user-agent") return false;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ userAgent: request.headers["user-agent"] }));
    return true;
  },
  async test(host) {
    const result = await host.execute("one", "browser_evaluate", { expression: "(async () => { const response = await fetch('/user-agent').then(r => r.json()); const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'], {type:'text/javascript'}))); const workerAgent = await new Promise(resolve => {worker.onmessage = e => resolve(e.data)}); worker.terminate(); return {network:response.userAgent, page:navigator.userAgent, worker:workerAgent}; })()" });
    const { network, page, worker } = result.value;
    assert.match(page, new RegExp(`Chrome/${process.versions.chrome.split(".")[0]}\\.`));
    assert.doesNotMatch(page, /Electron\//);
    assert.equal(page.includes(app.getName().replaceAll(" ", "")), false);
    assert.equal(network, page, "request headers and navigator use the same UA");
    assert.equal(worker, page, "workers inherit the browser UA");
    assert.match(session.defaultSession.getUserAgent(), /Electron\//, "application renderer session remains unchanged");
  },
};

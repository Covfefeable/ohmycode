import assert from "node:assert/strict";
import test from "node:test";
import { NetworkDiagnostics } from "../dist/network-diagnostics.js";

function fixture() {
  const calls = [];
  const network = new NetworkDiagnostics({ debugger: { async sendCommand(method) { calls.push(method); return { body: "x".repeat(40_000), base64Encoded: false }; } } });
  const request = (id, extra = {}) => network.handle("Network.requestWillBeSent", { requestId: id, timestamp: 1, wallTime: 1, type: "Fetch", request: { url: `https://example.com/${id}?api_key=fixture-secret`, method: "GET", headers: { Authorization: "fixture-secret", Cookie: "fixture-secret", Accept: "application/json" } }, ...extra });
  const finish = (id, mimeType = "application/json", status = 200) => {
    network.handle("Network.responseReceived", { requestId: id, response: { status, mimeType, headers: { "Set-Cookie": "fixture-secret" } } });
    network.handle("Network.loadingFinished", { requestId: id, timestamp: 1.25 });
  };
  return { network, calls, request, finish };
}

test("network summaries are bounded, filtered, and redact credentials before storage", async () => {
  const { network, request, finish } = fixture();
  for (let index = 0; index < 205; index++) { request(String(index)); finish(String(index), "application/json", index === 204 ? 500 : 200); }
  const list = await network.execute({ action: "list", failedOnly: true });
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].durationMs, 250);
  assert.equal((await network.execute({ action: "list" })).total, 200);
  assert.equal((await network.execute({ action: "list", url: "/0?" })).total, 0);
  const detail = await network.execute({ action: "detail", requestId: list.requests[0].id });
  assert.equal(JSON.stringify(detail).includes("fixture-secret"), false);
  assert.equal(detail.requestHeaders.Accept, "application/json");
  assert.equal(detail.requestId, undefined);
  await assert.rejects(network.execute({ action: "detail", requestId: "foreign" }), /browser_request_not_found/);
  await assert.rejects(network.execute({ action: "list", limit: 101 }), /browser_invalid_limit/);
});

test("body reads are explicit, textual, capped, and never alias a redirect's final response", async () => {
  const { network, calls, request, finish } = fixture();
  request("one");
  let id = (await network.execute({ action: "list" })).requests[0].id;
  assert.equal((await network.execute({ action: "body", requestId: id })).reason, "request_not_completed");
  finish("one", "image/png");
  assert.equal((await network.execute({ action: "body", requestId: id })).reason, "non_text_response");
  assert.equal(calls.length, 0);
  request("one", { redirectResponse: { status: 302, mimeType: "text/html", headers: {} } });
  assert.equal((await network.execute({ action: "body", requestId: id })).reason, "redirect_body_unavailable");
  finish("one");
  id = (await network.execute({ action: "list" })).requests.at(-1).id;
  const body = await network.execute({ action: "body", requestId: id });
  assert.equal(body.body.length, 32_000);
  assert.equal(body.truncated, true);
  assert.deepEqual(calls, ["Network.getResponseBody"]);
});

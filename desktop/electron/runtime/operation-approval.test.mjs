import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers";
import { setTimeout } from "node:timers/promises";
import { approveOperation, approvalState, replyApproval, setApprovalMode, setApprovalAssessor, withOperationApproval } from "../../dist-electron/runtime/operation-approval.js";
import { executeFileTool } from "../../dist-electron/files/file-tools.js";

function input(id, controller = new globalThis.AbortController(), extra = {}) {
  return { conversationId: id, userRequest: "Update the project", automatic: false, signal: controller.signal, tool: "terminal", arguments: {}, approvedPaths: new Set(), ...extra };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitRequest(id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const request = approvalState(id).requests[0];
    if (request) return request;
    await setTimeout(5);
  }
  throw new Error("approval did not arrive");
}

test("manual approval pauses the original call, validates ownership and allows only once", async () => {
  let executed = false;
  const operation = withOperationApproval(input("manual"), async () => {
    await approveOperation("terminal", "git status");
    executed = true;
  });
  const request = approvalState("manual").requests[0];
  assert.equal(executed, false);
  assert.equal(request.status, "waiting");
  assert.equal(request.reason, undefined);
  assert.throws(() => replyApproval("other", request.id, true), /approval_not_found/);
  replyApproval("manual", request.id, true);
  await operation;
  assert.equal(executed, true);
  assert.equal(approvalState("manual").requests.length, 0);
  const next = withOperationApproval(input("manual"), () => approveOperation("terminal", "git status"));
  replyApproval("manual", approvalState("manual").requests[0].id, false);
  await assert.rejects(next, /operation_rejected/);
});

test("allow mode and collaboration bypass both the model and human approval", async () => {
  setApprovalAssessor(async () => { throw new Error("model must not run"); });
  setApprovalMode("allowed", "allow");
  await withOperationApproval(input("allowed"), () => approveOperation("terminal", "command"));
  await withOperationApproval(input("collaboration", undefined, { automatic: true }), () => approveOperation("terminal", "command"));
  assert.equal(approvalState("collaboration").requests.length, 0);
});

test("model approves safe operations and supplies the only risk explanation", async () => {
  setApprovalMode("assessed", "auto");
  let supplied;
  setApprovalAssessor(async (value) => { supplied = value; return { decision: "allow" }; });
  await withOperationApproval(input("assessed"), () => approveOperation("terminal", "git status"));
  assert.equal(supplied.details, "git status");
  assert.equal("triggerReason" in supplied, false);
  setApprovalAssessor(async () => ({ decision: "ask", reason: "Model explanation" }));
  const operation = withOperationApproval(input("assessed"), () => approveOperation("terminal", "git reset --hard"));
  await tick();
  const request = approvalState("assessed").requests[0];
  assert.equal(request.reason, "Model explanation");
  replyApproval("assessed", request.id, false);
  await assert.rejects(operation, /operation_rejected/);
});

test("model failure falls back to manual approval without a fabricated warning", async () => {
  setApprovalMode("failure", "auto");
  setApprovalAssessor(async () => { throw new Error("offline"); });
  const operation = withOperationApproval(input("failure"), () => approveOperation("terminal", "command"));
  await tick();
  const request = approvalState("failure").requests[0];
  assert.equal(request.status, "waiting");
  assert.equal(request.reason, undefined);
  replyApproval("failure", request.id, true);
  await operation;
});

test("stop cancels pending assessment and late model approval cannot execute", async () => {
  setApprovalMode("stopped", "auto");
  let complete;
  setApprovalAssessor(() => new Promise((resolve) => { complete = resolve; }));
  const controller = new globalThis.AbortController();
  let executed = false;
  const operation = withOperationApproval(input("stopped", controller), async () => {
    await approveOperation("terminal", "command");
    executed = true;
  });
  controller.abort();
  await assert.rejects(operation, /operation_cancelled/);
  complete({ decision: "allow" });
  await tick();
  assert.equal(executed, false);
  assert.equal(approvalState("stopped").requests.length, 0);
});

test("parallel requests remain independent", async () => {
  const first = withOperationApproval(input("parallel"), () => approveOperation("terminal", "one"));
  const second = withOperationApproval(input("parallel"), () => approveOperation("terminal", "two"));
  const requests = approvalState("parallel").requests;
  replyApproval("parallel", requests[0].id, true);
  await first;
  assert.equal(approvalState("parallel").requests.length, 1);
  replyApproval("parallel", requests[1].id, false);
  await assert.rejects(second, /operation_rejected/);
});

test("workspace edits need no approval; external reads and edits use the same approval flow", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ohmycode-approval-")));
  const root = path.join(directory, "workspace");
  await mkdir(root);
  const inside = path.join(root, "inside.txt");
  const outside = path.join(directory, "outside.txt");
  await writeFile(inside, "old\n");
  await writeFile(outside, "external\n");
  const inspected = new Set([inside]);
  const patch = "*** Begin Patch\n*** Update File: inside.txt\n@@\n-old\n+new\n*** End Patch";
  await withOperationApproval(input("files", undefined, { workspace: root, tool: "apply_patch", arguments: { patch } }), () => executeFileTool("apply_patch", { projectId: "test", patch }, root, inspected));
  assert.equal(await readFile(inside, "utf8"), "new\n");
  assert.equal(approvalState("files").requests.length, 0);
  const reading = withOperationApproval(input("files", undefined, { tool: "read_file", arguments: { path: outside } }), () => executeFileTool("read_file", { projectId: "test", path: outside }, root, inspected));
  const request = await waitRequest("files");
  assert.equal(JSON.parse(request.details).path, outside);
  replyApproval("files", request.id, true);
  const read = await reading;
  inspected.add(read.path);
  const externalPatch = `*** Begin Patch\n*** Update File: ${outside}\n@@\n-external\n+changed\n*** End Patch`;
  const editing = withOperationApproval(input("files", undefined, { tool: "apply_patch", arguments: { patch: externalPatch } }), () => executeFileTool("apply_patch", { projectId: "test", patch: externalPatch }, root, inspected));
  replyApproval("files", (await waitRequest("files")).id, false);
  await assert.rejects(editing, /operation_rejected/);
  assert.equal(await readFile(outside, "utf8"), "external\n");
});

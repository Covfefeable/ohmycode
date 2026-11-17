import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ApprovalMode, OperationApproval } from "../../contracts/domain.js";

type ApprovalContext = {
  conversationId: string;
  userRequest: string;
  workspace?: string;
  automatic: boolean;
  signal: AbortSignal;
  tool: string;
  arguments: unknown;
  approvedPaths: Set<string>;
  approvedOperations: Set<string>;
};
type Pending = { request: OperationApproval; settle(allowed: boolean): void };
type Assessment = { decision: "allow" | "ask"; reason?: string };
type Preferences = { get(id: string): ApprovalMode | undefined; set(id: string, mode: ApprovalMode): void };
const context = new AsyncLocalStorage<ApprovalContext>();
const modes = new Map<string, ApprovalMode>();
const pending = new Map<string, Pending>();
let preferences: Preferences | undefined;
let assess = async (input: Record<string, unknown>, signal: AbortSignal): Promise<Assessment> => {
  const { apiRequest } = await import("../api/api-client.js");
  return apiRequest("/api/settings/operation-approval", { method: "POST", signal, body: JSON.stringify(input) });
};
export function setApprovalAssessor(callback: typeof assess): void { assess = callback; }
export function setApprovalPreferences(store: Preferences | undefined): void { preferences = store; }
function modeFor(id: string): ApprovalMode { return preferences?.get(id) ?? modes.get(id) ?? "ask"; }
export function cancelOperationApprovals(): void {
  for (const item of pending.values()) item.settle(false);
  modes.clear();
}
let publish: (conversationId: string) => void = () => {};
export function setApprovalPublisher(callback: typeof publish): void { publish = callback; }

export function approvalState(conversationId: string) {
  return { mode: modeFor(conversationId), requests: [...pending.values()].map((item) => item.request).filter((item) => item.conversationId === conversationId) };
}

export function setApprovalMode(conversationId: string, mode: ApprovalMode): void {
  if (!["ask", "auto", "allow"].includes(mode)) throw new Error("invalid_approval_mode");
  modes.set(conversationId, mode);
  preferences?.set(conversationId, mode);
  publish(conversationId);
}

export function replyApproval(conversationId: string, id: string, allowed: boolean): void {
  const item = pending.get(id);
  if (!item || item.request.conversationId !== conversationId || item.request.status !== "waiting" || typeof allowed !== "boolean") throw new Error("approval_not_found");
  item.settle(allowed);
}

export function withOperationApproval<T>(input: Omit<ApprovalContext, "approvedOperations">, execute: () => Promise<T>): Promise<T> {
  return context.run({ ...input, approvedOperations: new Set() }, execute);
}

export async function approveOperation(operation: string, details: string): Promise<void> {
  const current = context.getStore();
  if (!current) throw new Error("operation_approval_context_required");
  current.signal.throwIfAborted();
  const key = JSON.stringify([operation, details]);
  if (current.approvedOperations.has(key)) return;
  if (current.automatic || modeFor(current.conversationId) === "allow") return;
  const automatic = modeFor(current.conversationId) === "auto";
  const request: OperationApproval = { id: randomUUID(), conversationId: current.conversationId, operation, details, workspace: current.workspace, status: automatic ? "checking" : "waiting" };
  await new Promise<void>((resolve, reject) => {
    const finish = (allowed: boolean) => {
      pending.delete(request.id);
      publish(current.conversationId);
      current.signal.removeEventListener("abort", abort);
      if (allowed && !current.signal.aborted) resolve();
      else reject(new Error(current.signal.aborted ? "operation_cancelled" : "operation_rejected"));
    };
    const abort = () => finish(false);
    pending.set(request.id, { request, settle: finish });
    publish(current.conversationId);
    current.signal.addEventListener("abort", abort, { once: true });
    if (current.signal.aborted) { abort(); return; }
    if (!automatic) return;
    void assess({ userRequest: current.userRequest, operation, details, workspace: current.workspace, platform: process.platform }, current.signal).then((result) => {
      if (!pending.has(request.id)) return;
      if (result.decision === "allow") { finish(true); return; }
      request.status = "waiting";
      if (typeof result.reason === "string") request.reason = result.reason;
      publish(current.conversationId);
    }).catch(() => {
      if (!pending.has(request.id)) return;
      request.status = "waiting";
      publish(current.conversationId);
    });
  });
  current.signal.throwIfAborted();
  current.approvedOperations.add(key);
}

export async function approveExternalPath(root: string, target: string): Promise<void> {
  const current = context.getStore();
  if (!current) throw new Error("path_outside_workspace");
  if (current.approvedPaths.has(target)) return;
  await approveOperation("external_file", JSON.stringify({ tool: current.tool, workspace: root, path: target, arguments: current.arguments }, null, 2));
  current.approvedPaths.add(target);
}

import type { AgentStreamEvent } from "@ohmycode/agent-runtime";

import type { MobileActivityStep } from "../api/mobile-chat-api";

export function updateMobileActivity(steps: MobileActivityStep[], event: AgentStreamEvent): MobileActivityStep[] {
  const next = steps.map((step) => ({ ...step })) as MobileActivityStep[];
  const completeRunning = () => {
    for (const step of next) {
      if ("status" in step && step.status === "running") step.status = "completed";
    }
  };

  if (event.type === "run.started") {
    completeRunning();
    next.push({ id: `run-${event.runId}`, type: "run", status: "running" });
  } else if (event.type === "task.plan.updated") {
    const index = next.findIndex((step) => step.type === "task_plan");
    const plan = { id: "task-plan-live", type: "task_plan" as const, tasks: event.tasks };
    if (index >= 0) next[index] = plan;
    else next.push(plan);
  } else if (event.type === "reasoning.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: event.stepId, type: "reasoning", content: "", status: "running" });
  } else if (event.type === "reasoning.delta") {
    const step = [...next].reverse().find((item) => item.type === "reasoning" && item.status === "running");
    if (step?.type === "reasoning") step.content += event.content;
  } else if (event.type === "message.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: `message-${Date.now()}-${next.length}`, type: "message", content: "", status: "running" });
  } else if (event.type === "message.delta") {
    const step = [...next].reverse().find((item) => item.type === "message" && item.status === "running");
    if (step?.type === "message") step.content += event.content;
  } else if (event.type === "tool.requested") {
    for (const step of next) {
      if ((step.type === "reasoning" || step.type === "message") && step.status === "running") step.status = "completed";
    }
    if (event.tool !== "update_tasks") next.push({ id: event.callId, type: "tool", tool: event.tool, input: event.arguments, status: "running", taskId: event.taskId });
  } else if (event.type === "tool.completed") {
    const step = next.find((item) => item.type === "tool" && item.id === event.callId);
    if (step?.type === "tool") {
      step.result = event.result;
      step.status = "completed";
    }
  }

  return next;
}

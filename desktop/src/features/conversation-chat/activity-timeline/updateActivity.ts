export function updateActivity(steps: AgentActivityStep[], event: ConversationStreamEvent | RuntimeEvent): AgentActivityStep[] {
  const next = steps.map((step) => ({ ...step }));
  if (event.type === "turn.started") {
    for (const step of next) if (step.type !== "task_plan" && step.status === "running") step.status = "completed";
    next.push({ id: `run-${event.turnId}`, type: "run", status: "running" });
  } else if (event.type === "task.updated") {
    const currentRun = [...next].reverse().findIndex((step) => step.type === "run");
    const start = currentRun < 0 ? 0 : next.length - 1 - currentRun;
    const planIndex = next.findIndex((step, index) => index >= start && step.type === "task_plan");
    const plan = { id: `task-plan-${event.turnId}`, type: "task_plan" as const, tasks: event.tasks };
    if (planIndex >= 0) next[planIndex] = plan;
    else next.push(plan);
  } else if (event.type === "item.started") {
    const item = event.item;
    if (item.kind === "reasoning") next.push({ id: item.id, type: "reasoning", content: item.content ?? "", status: "running", taskId: item.taskId });
    if (item.kind === "agent_message") next.push({ id: item.id, type: "message", content: item.content ?? "", status: "running", taskId: item.taskId });
    if (item.kind === "tool") next.push({ id: item.id, type: "tool", tool: item.tool ?? "tool", input: item.input as TerminalAction, status: "running", taskId: item.taskId });
    if (item.kind === "context") next.push({ id: item.id, type: "context", status: "running", taskId: item.taskId });
  } else if (event.type === "item.delta") {
    const step = next.find((item) => item.id === event.itemId);
    if (step && (step.type === "reasoning" || step.type === "message")) step.content += event.delta;
  } else if (event.type === "item.completed") {
    const step = next.find((item) => item.id === event.item.id);
    if (step && step.type !== "task_plan") {
      step.status = "completed";
      if (step.type === "tool") step.result = event.item.output;
      if ((step.type === "reasoning" || step.type === "message") && event.item.content !== undefined) step.content = event.item.content;
    }
  } else if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
    for (const step of next) if (step.type !== "task_plan" && step.status === "running") step.status = "completed";
  } else if (event.type === "task.plan.updated") {
    const planIndex = next.findIndex((step) => step.type === "task_plan");
    const plan = { id: "task-plan-live", type: "task_plan" as const, tasks: event.tasks };
    if (planIndex >= 0) next[planIndex] = plan;
    else next.push(plan);
  } else if (event.type === "run.started") {
    for (const step of next) if (step.type !== "task_plan" && step.status === "running") step.status = "completed";
    let lastRunIndex = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index].type === "run") { lastRunIndex = index; break; }
    }
    const pendingRun = lastRunIndex >= 0
      && next.slice(lastRunIndex + 1).every((step) => step.type === "message" && step.id.startsWith("user-"));
    if (pendingRun) next[lastRunIndex] = { id: `run-${event.runId}`, type: "run", status: "running" };
    else next.push({ id: `run-${event.runId}`, type: "run", status: "running" });
  } else if (event.type === "reasoning.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: event.stepId, type: "reasoning", content: "", status: "running" });
  } else if (event.type === "reasoning.delta") {
    const step = [...next].reverse().find((item) => item.type === "reasoning" && item.status === "running");
    if (step?.type === "reasoning") step.content += event.content;
  } else if (event.type === "message.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: `message-${crypto.randomUUID()}`, type: "message", content: "", status: "running" });
  } else if (event.type === "message.delta") {
    const step = [...next].reverse().find((item) => item.type === "message" && item.status === "running");
    if (step?.type === "message") step.content += event.content;
  } else if (event.type === "tool.requested") {
    for (const step of next) if (step.type === "reasoning" || step.type === "message") step.status = "completed";
    if (event.tool === "update_tasks") return next;
    next.push({ id: event.callId, type: "tool", tool: event.tool, input: event.tool === "terminal" ? event.arguments as TerminalAction : JSON.stringify(event.arguments), status: "running", taskId: event.taskId });
  } else if (event.type === "tool.completed") {
    const step = next.find((item) => item.type === "tool" && item.id === event.callId);
    if (step?.type === "tool") { step.result = event.result; step.status = "completed"; }
  }
  return next;
}

export function withoutFinalResponse(steps: AgentActivityStep[], finalContent?: string): AgentActivityStep[] {
  if (!finalContent?.trim()) return steps;
  const normalizedFinal = finalContent.trim();
  let finalIndex = -1;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.type === "message" && step.content.trim() === normalizedFinal) {
      finalIndex = index;
      break;
    }
  }
  return finalIndex < 0 ? steps : steps.filter((_, index) => index !== finalIndex);
}

export function updateActivity(steps: AgentActivityStep[], event: ConversationStreamEvent): AgentActivityStep[] {
  const next = steps.map((step) => ({ ...step }));
  if (event.type === "run.started") {
    for (const step of next) if (step.status === "running") step.status = "completed";
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
    next.push({ id: event.callId, type: "tool", tool: event.tool, input: event.tool === "terminal" ? event.arguments as TerminalAction : JSON.stringify(event.arguments), status: "running" });
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

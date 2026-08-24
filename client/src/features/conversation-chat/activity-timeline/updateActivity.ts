export function updateActivity(steps: AgentActivityStep[], event: ConversationStreamEvent): AgentActivityStep[] {
  const next = steps.map((step) => ({ ...step }));
  if (event.type === "reasoning.started") {
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

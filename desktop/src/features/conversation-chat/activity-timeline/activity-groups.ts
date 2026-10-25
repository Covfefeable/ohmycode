import { toolPresentation } from "./tool-presentation";

type ExecutionStep = Exclude<AgentActivityStep, { type: "message" | "run" | "task_plan" }>;
export type ActivityEntry = Extract<AgentActivityStep, { type: "message" }> | { id: string; type: "group"; steps: ExecutionStep[] };

export function groupActivitySteps(steps: AgentActivityStep[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const step of steps) {
    if (step.type === "run" || step.type === "task_plan") continue;
    if (step.type === "message") {
      if (step.content.trim()) entries.push(step);
      continue;
    }
    const previous = entries.at(-1);
    if (previous?.type === "group") previous.steps.push(step);
    else entries.push({ id: `group-${step.id}`, type: "group", steps: [step] });
  }
  return entries;
}

export function activitySummaryKeys(steps: ExecutionStep[]): string[] {
  const keys = new Set<string>();
  for (const step of steps) {
    if (step.type === "context") keys.add("agent.compactedContext");
    if (step.type !== "tool") continue;
    if (step.tool.startsWith("browser_")) keys.add("agent.groupBrowser");
    else if (step.tool.startsWith("android_")) keys.add("agent.groupAndroid");
    else {
      const presentation = toolPresentation(step.tool);
      keys.add(presentation.kind === "terminal" ? "agent.groupCommands"
        : presentation.kind === "file" ? presentation.icon === "edit" ? "agent.groupEdits" : "agent.groupReads"
          : "agent.groupTools");
    }
  }
  return keys.size ? [...keys] : ["agent.thought"];
}

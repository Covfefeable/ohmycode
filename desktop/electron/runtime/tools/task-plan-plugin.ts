import { defineToolPlugin, TASK_PLAN_DEFINITION, type AgentTask } from "@ohmycode/agent-runtime";
import type { ToolCall, ToolPlugin } from "@ohmycode/tool-contracts";

function updateTasks(call: ToolCall): unknown {
  const tasks = (call.arguments as { tasks?: AgentTask[] }).tasks;
  const valid = Array.isArray(tasks)
    && tasks.length <= 20
    && new Set(tasks.map((task) => task.id)).size === tasks.length
    && tasks.filter((task) => task.status === "in_progress").length <= 1
    && tasks.every((task) => task.id?.trim() && task.id.length <= 80
      && task.content?.trim() && task.content.length <= 300
      && ["pending", "in_progress", "completed"].includes(task.status));
  return valid ? { updated: true, taskCount: tasks.length } : { error: "invalid_task_plan" };
}

export function createTaskPlanPlugin(): ToolPlugin {
  return defineToolPlugin({
    id: "task-plan",
    definitions: [TASK_PLAN_DEFINITION],
    execute: updateTasks,
  });
}

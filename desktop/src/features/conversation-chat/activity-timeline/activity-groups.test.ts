import { expect, it } from "vitest";
import { activitySummaryKeys, groupActivitySteps } from "./activity-groups";

const tool = (id: string, name: string): Extract<AgentActivityStep, { type: "tool" }> => ({ id, type: "tool", tool: name, input: {}, status: "completed" });

it("groups between visible messages without reordering task-linked steps", () => {
  const steps: AgentActivityStep[] = [
    { id: "first", type: "message", content: "Download first", status: "completed", taskId: "one" },
    { ...tool("read", "read_file"), taskId: "two" },
    { id: "thinking", type: "reasoning", content: "Check response", status: "completed" },
    { id: "empty", type: "message", content: "", status: "running" },
    tool("command", "terminal"),
    { id: "second", type: "message", content: "Try the browser instead", status: "completed", taskId: "two" },
    tool("browser", "browser_download"),
  ];
  const before = structuredClone(steps);
  const entries = groupActivitySteps(steps);
  expect(entries.map((entry) => entry.id)).toEqual(["first", "group-read", "second", "group-browser"]);
  expect(entries[1].type === "group" && entries[1].steps.map((step) => step.id)).toEqual(["read", "thinking", "command"]);
  expect(steps).toEqual(before);
});

it("summarizes categories once, including browser and Android screenshots", () => {
  const entries = groupActivitySteps([
    tool("read", "read_file"), tool("read2", "list_directory"), tool("edit", "apply_patch"),
    tool("command", "terminal"), tool("browser", "browser_screenshot"), tool("android", "android_screenshot"), tool("mcp", "mcp__bing__search"),
  ]);
  expect(entries[0].type === "group" && activitySummaryKeys(entries[0].steps)).toEqual([
    "agent.groupReads", "agent.groupEdits", "agent.groupCommands", "agent.groupBrowser", "agent.groupAndroid", "agent.groupTools",
  ]);
});

it("keeps reasoning and compaction accessible when no tools were used", () => {
  const entries = groupActivitySteps([{ id: "reasoning", type: "reasoning", content: "Thinking", status: "running" }]);
  expect(entries[0].type === "group" && activitySummaryKeys(entries[0].steps)).toEqual(["agent.thought"]);
  expect(activitySummaryKeys([{ id: "context", type: "context", status: "completed" }])).toEqual(["agent.compactedContext"]);
});

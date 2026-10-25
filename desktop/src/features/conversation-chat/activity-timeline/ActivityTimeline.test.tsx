import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActivityTimeline } from "./ActivityTimeline";
import { ActivityExpansionProvider } from "./ActivityExpansionProvider";

vi.mock("../../../shared/ui/markdown-content", () => ({ MarkdownContent: ({ children }: { children: string }) => <div>{children}</div> }));

const steps: AgentActivityStep[] = [
  { id: "update1", type: "message", content: "Download first", status: "completed" },
  { id: "thinking", type: "reasoning", content: "Internal reasoning", status: "completed" },
  { id: "command", type: "tool", tool: "terminal", input: { command: "echo first" }, status: "completed", taskId: "task" },
  { id: "update2", type: "message", content: "Try the browser instead", status: "completed" },
  { id: "browser", type: "tool", tool: "browser_download", input: { action: "list" }, status: "running" },
];

it("supports whole-run collapse and preserves independently expanded groups", () => {
  const view = render(<ActivityExpansionProvider><ActivityTimeline steps={steps} active /></ActivityExpansionProvider>);
  expect(screen.getByText("Download first")).toBeTruthy();
  expect(screen.getByText("Try the browser instead")).toBeTruthy();
  const commands = screen.getByRole("button", { name: "Ran commands" });
  expect(commands.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("button", { name: "Used browser" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("echo first")).toBeNull();
  fireEvent.click(commands);
  expect(screen.getByText("echo first")).toBeTruthy();
  expect(screen.queryByText("Internal reasoning")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Working" }));
  expect(screen.queryByText("Download first")).toBeNull();
  expect(screen.queryByText("echo first")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Working" }));
  expect(screen.getByText("echo first")).toBeTruthy();
  view.rerender(<ActivityExpansionProvider><ActivityTimeline steps={steps.map((step) => step.type === "tool" ? { ...step, status: "completed" } : step)} active={false} durationMs={5000} /></ActivityExpansionProvider>);
  expect(screen.getByText("Took 5s")).toBeTruthy();
  expect(screen.queryByText("Download first")).toBeNull();
  expect(screen.getByRole("button", { name: "Took 5s" }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Took 5s" }));
  expect(screen.getByText("Download first")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ran commands" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "Used browser" }).getAttribute("aria-expanded")).toBe("false");
});

it("preserves run boundaries and shows plan status without regrouping activity by task", () => {
  render(<ActivityTimeline steps={[
    { id: "run1", type: "run", status: "completed" },
    ...steps.slice(0, 3),
    { id: "run2", type: "run", status: "running" },
    { id: "plan", type: "task_plan", tasks: [{ id: "task", content: "Install application", status: "in_progress" }] },
    ...steps.slice(3),
  ]} active />);
  expect(screen.getByText("Install application")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ran commands" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  expect(screen.getByRole("button", { name: "Ran commands" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("button", { name: "Used browser" }).getAttribute("aria-expanded")).toBe("false");
});

it("stops plan spinners when a turn ends without claiming unfinished tasks succeeded", () => {
  const plan: Extract<AgentActivityStep, { type: "task_plan" }> = { id: "plan", type: "task_plan", tasks: [
    { id: "done", content: "Finished work", status: "completed" },
    { id: "current", content: "Unconfirmed work", status: "in_progress" },
    { id: "pending", content: "Remaining work", status: "pending" },
  ] };
  const plannedSteps = [plan];
  const view = render(<ActivityTimeline steps={plannedSteps} active />);
  expect(screen.getByRole("img", { name: "In progress" })).toBeTruthy();
  view.rerender(<ActivityTimeline steps={plannedSteps} active={false} durationMs={230000} />);
  fireEvent.click(screen.getByRole("button", { name: "Took 3m 50s" }));
  expect(screen.queryByRole("img", { name: "In progress" })).toBeNull();
  expect(screen.getByRole("img", { name: "Completed" })).toBeTruthy();
  expect(screen.getAllByRole("img", { name: "Unfinished (turn ended)" })).toHaveLength(2);
  expect(plan.tasks[1].status).toBe("in_progress");
  view.unmount();
  render(<ActivityTimeline steps={plannedSteps} active={false} durationMs={230000} />);
  fireEvent.click(screen.getByRole("button", { name: "Took 3m 50s" }));
  expect(screen.queryByRole("img", { name: "In progress" })).toBeNull();
});

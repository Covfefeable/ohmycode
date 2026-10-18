import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { FollowupStrip } from "./FollowupStrip";

test("排队条展示正文，点击引导和撤销传递准确的消息 ID", async () => {
  const user = userEvent.setup(), onSteer = vi.fn(), onWithdraw = vi.fn();
  render(<FollowupStrip state={{ paused: false, inputs: [{ id: "one", content: "Next requirement", attachments: [], status: "queued" }] }} running onSteer={onSteer} onWithdraw={onWithdraw} onResume={() => {}} />);
  expect(screen.getByText("Next requirement")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Steer current task" }));
  expect(onSteer).toHaveBeenCalledExactlyOnceWith("one");
  await user.click(screen.getByRole("button", { name: "Withdraw to draft" }));
  expect(onWithdraw).toHaveBeenCalledExactlyOnceWith("one");
});

test("引导等待状态不能再次引导或撤销；暂停后提供显式继续", async () => {
  const user = userEvent.setup(), onResume = vi.fn();
  render(<FollowupStrip state={{ paused: true, inputs: [{ id: "one", content: "Guidance", attachments: [], status: "steering" }] }} running={false} onSteer={() => {}} onWithdraw={() => {}} onResume={onResume} />);
  expect(screen.getByText("Waiting to be received")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Withdraw to draft" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continue sending" }));
  expect(onResume).toHaveBeenCalledOnce();
});

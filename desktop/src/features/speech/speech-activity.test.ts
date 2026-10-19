import { expect, test, vi } from "vitest";
import { SpeechActivity } from "./speech-activity";

test("短促声响即使误识别出文字也不打断；静音重置连续发声时间", () => {
  const interrupt = vi.fn();
  const activity = new SpeechActivity(interrupt);
  activity.transcript("嗯");
  activity.audio(0.5, 200);
  activity.audio(0, 100);
  activity.audio(0.5, 200);
  expect(interrupt).not.toHaveBeenCalled();
  activity.audio(0.5, 200);
  expect(interrupt).toHaveBeenCalledOnce();
});

test("只有音量不打断，持续语音和文字均存在才触发，每次发言一次", () => {
  const interrupt = vi.fn();
  const activity = new SpeechActivity(interrupt);
  activity.audio(0.5, 500);
  expect(interrupt).not.toHaveBeenCalled();
  activity.transcript("等等");
  activity.transcript("等一下");
  expect(interrupt).toHaveBeenCalledOnce();
  activity.reset();
  activity.transcript("下一句");
  expect(interrupt).toHaveBeenCalledOnce();
  activity.audio(0.5, 400);
  expect(interrupt).toHaveBeenCalledTimes(2);
});

test("轻声或短句的最终识别不受本地音量门槛阻挡", () => {
  const interrupt = vi.fn();
  const activity = new SpeechActivity(interrupt);
  activity.audio(0.01, 100);
  activity.transcript("换个话题", false);
  expect(interrupt).not.toHaveBeenCalled();
  activity.transcript("换个话题", true);
  expect(interrupt).toHaveBeenCalledOnce();
});

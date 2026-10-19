import { expect, test } from "vitest";
import { messageSpeechText, speechText } from "./speech-text";

test("朗读自然语言及链接标题，不朗读代码块、图片地址或 HTML", () => {
  expect(
    speechText(
      "再确认**连云港东站**。\n\n[车次](https://example.com)\n\n```sh\nsecret command\n```\n\n![图](local.png)\n\n<div>",
    ),
  ).toBe("再确认连云港东站。\n车次");
  expect(speechText('说明。\n```json\n{"partial":')).toBe("说明。");
});

test("步骤文字与最终回答按顺序朗读，排除思考及工具输出，不重复最终回答", () => {
  const message: LocalMessage = {
    id: "one",
    role: "assistant",
    createdAt: "",
    content: "完成。",
    activity: [
      {
        id: "a",
        type: "message",
        content: "再确认一下。",
        status: "completed",
      },
      { id: "b", type: "reasoning", content: "hidden", status: "completed" },
      {
        id: "c",
        type: "tool",
        tool: "read_file",
        input: {},
        result: "raw",
        status: "completed",
      },
      { id: "d", type: "message", content: "完成。", status: "completed" },
    ],
  };
  expect(messageSpeechText(message)).toBe("再确认一下。\n完成。");
});

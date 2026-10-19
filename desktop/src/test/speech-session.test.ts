import { once } from "node:events";
import { WebSocketServer } from "ws";
import { expect, test } from "vitest";
import { DashscopeSession } from "../../electron/speech/dashscope-session";
import type { SpeechEvent } from "../../electron/speech/types";

async function provider() {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Missing address");
  return { server, connection: { url: `ws://127.0.0.1:${address.port}`, apiKey: "test-only", voice: "longanhuan_v3.1" } };
}

test("TTS 等待 task-started 后逐段发送文本，收到音频并正常结束", async () => {
  const { server, connection } = await provider();
  const commands: Array<{ header: { action: string; task_id: string }; payload: { model?: string; parameters?: { format: string }; input: { text?: string } } }> = [];
  server.on("connection", (socket, request) => {
    expect(request.headers.authorization).toBe("Bearer test-only");
    socket.on("message", (data) => {
      const command = JSON.parse(data.toString()); commands.push(command);
      if (command.header.action === "run-task") socket.send(JSON.stringify({ header: { event: "task-started" }, payload: {} }));
      if (command.header.action === "continue-task") socket.send(Buffer.from([1, 0, 2, 0]));
      if (command.header.action === "finish-task") socket.send(JSON.stringify({ header: { event: "task-finished" }, payload: {} }));
    });
  });
  const events: SpeechEvent[] = [];
  const session = new DashscopeSession("tts", connection, (event) => events.push(event));
  try {
    await session.ready;
    session.append("再确认一下。"); session.append("完成。"); session.finish();
    await session.done;
    expect(commands.map((command) => command.header.action)).toEqual(["run-task", "continue-task", "continue-task", "finish-task"]);
    expect(new Set(commands.map((command) => command.header.task_id)).size).toBe(1);
    expect(commands[0].payload.model).toBe("qwen-audio-3.1-tts-flash");
    expect(commands[0].payload.parameters?.format).toBe("pcm");
    expect(events.map((event) => event.type)).toEqual(["audio", "audio", "finished"]);
  } finally { session.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("ASR 修正保留 sentenceId，心跳不作为文字，意外断线返回明确错误", async () => {
  const { server, connection } = await provider();
  const events: SpeechEvent[] = [];
  server.on("connection", (socket) => socket.on("message", (_data, binary) => {
    if (binary) {
      for (const sentence of [{ sentence_id: 0, heartbeat: true }, { sentence_id: 1, text: "东", sentence_end: false }, { sentence_id: 1, text: "东站", sentence_end: true }]) {
        socket.send(JSON.stringify({ header: { event: "result-generated" }, payload: { output: { sentence } } }));
      }
      socket.close();
    } else socket.send(JSON.stringify({ header: { event: "task-started" }, payload: {} }));
  }));
  const session = new DashscopeSession("asr", connection, (event) => events.push(event));
  try {
    await session.ready; session.append(new Uint8Array([0, 0])); await session.done;
    expect(events).toEqual([
      { type: "transcript", sentenceId: 1, text: "东", final: false },
      { type: "transcript", sentenceId: 1, text: "东站", final: true },
      { type: "error", code: "speech_connection_closed" },
    ]);
  } finally { session.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("任务开始前取消会释放连接并结束等待", async () => {
  const { server, connection } = await provider();
  const session = new DashscopeSession("asr", connection, () => {});
  const rejected = expect(session.ready).rejects.toThrow("speech_cancelled");
  session.close();
  await rejected; await session.done;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

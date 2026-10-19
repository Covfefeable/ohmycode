import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SpeechService } from "../../electron/speech/speech-service";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  created: [] as Array<{
    done: Promise<void>;
    finish(): void;
    close: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("../../electron/api/api-client.js", () => ({
  apiRequest: mocks.request,
}));
vi.mock("../../electron/speech/dashscope-session.js", () => ({
  DashscopeSession: class {
    ready = Promise.resolve();
    done: Promise<void>;
    close: ReturnType<typeof vi.fn>;
    constructor() {
      let finish!: () => void;
      this.done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      this.close = vi.fn(finish);
      mocks.created.push({ done: this.done, finish, close: this.close });
    }
  },
}));
let service: SpeechService;
beforeEach(() => {
  mocks.created.length = 0;
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({
    url: "wss://example.invalid",
    apiKey: "test-key",
    voice: "test",
  });
  service = new SpeechService(vi.fn());
});
afterEach(() => service.stop());

test("多个朗读任务严格按顺序启动，不会交错音频", async () => {
  await service.start("one", "tts");
  const second = service.start("two", "tts");
  const third = service.start("three", "tts");
  expect(mocks.created).toHaveLength(1);
  mocks.created[0].finish();
  await second;
  expect(mocks.created).toHaveLength(2);
  mocks.created[1].finish();
  await third;
  expect(mocks.created).toHaveLength(3);
});

test("停止会取消排队的朗读，但不会停止正在录音的连接", async () => {
  await service.start("asr", "asr");
  await service.start("tts", "tts");
  const waiting = expect(service.start("next", "tts")).rejects.toThrow(
    "speech_cancelled",
  );
  service.stop("tts");
  await waiting;
  expect(mocks.created[0].close).not.toHaveBeenCalled();
  expect(mocks.created[1].close).toHaveBeenCalledOnce();
  expect(mocks.created).toHaveLength(2);
});

test("获取凭据期间停止不会在请求返回后重新建立连接", async () => {
  let respond!: (connection: object) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const started = service.start("input", "asr");
  const cancelled = expect(started).rejects.toThrow("speech_cancelled");
  service.stop();
  respond({ apiKey: "test-key" });
  await cancelled;
  expect(mocks.created).toHaveLength(0);
});

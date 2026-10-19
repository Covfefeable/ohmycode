import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { SpeechConnection, SpeechEvent, SpeechMode } from "./types.js";

const models = {
  asr: "qwen-audio-3.1-asr-flash-message",
  tts: "qwen-audio-3.1-tts-flash",
};

/** One provider task. Text/audio are accepted only after task-started. */
export class DashscopeSession {
  private socket: WebSocket;
  private taskId = randomUUID();
  private ended = false;
  private finishing = false;
  private started = false;
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private resolveDone!: () => void;
  private timeout: ReturnType<typeof setTimeout>;

  constructor(
    mode: SpeechMode,
    connection: SpeechConnection,
    private emit: (event: SpeechEvent) => void,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.socket = new WebSocket(connection.url, {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
      handshakeTimeout: 15000,
    });
    this.timeout = setTimeout(() => this.fail("speech_timeout"), 15000);
    this.socket.on("open", () =>
      this.send("run-task", {
        task_group: "audio",
        task: mode,
        function: mode === "asr" ? "recognition" : "SpeechSynthesizer",
        model: models[mode],
        input: {},
        parameters:
          mode === "asr"
            ? {
                format: "pcm",
                sample_rate: 16000,
                intermediate_result_enabled: true,
              }
            : {
                text_type: "PlainText",
                voice: connection.voice,
                format: "pcm",
                sample_rate: 24000,
              },
      }),
    );
    this.socket.on("message", (data, binary) => {
      if (this.ended) return;
      if (this.finishing) this.timeout.refresh();
      if (binary) {
        this.emit({ type: "audio", data: new Uint8Array(data as Buffer) });
        return;
      }
      try {
        const event = JSON.parse(data.toString());
        switch (event.header.event) {
          case "task-started":
            clearTimeout(this.timeout);
            this.started = true;
            this.resolveReady();
            break;
          case "result-generated": {
            const sentence = event.payload?.output?.sentence;
            if (mode === "asr" && sentence && !sentence.heartbeat)
              this.emit({
                type: "transcript",
                sentenceId: sentence.sentence_id,
                text: sentence.text,
                final: sentence.sentence_end,
              });
            break;
          }
          case "task-finished":
            this.close();
            this.emit({ type: "finished" });
            break;
          case "task-failed":
            this.fail(providerErrorCode(event.header.error_code));
            break;
        }
      } catch {
        this.fail("speech_protocol_error");
      }
    });
    this.socket.on("error", () => this.fail("speech_connection_failed"));
    this.socket.on("close", () => {
      if (!this.ended) this.fail("speech_connection_closed");
    });
  }

  private send(action: string, payload: object) {
    this.socket.send(
      JSON.stringify({
        header: { action, task_id: this.taskId, streaming: "duplex" },
        payload,
      }),
    );
  }

  append(value: string | Uint8Array) {
    if (!this.started || this.ended || this.finishing) return;
    if (typeof value === "string") {
      // DashScope limits a continue-task text payload to 20,000 characters.
      for (let index = 0; index < value.length; index += 20000)
        this.send("continue-task", {
          input: { text: value.slice(index, index + 20000) },
        });
    } else this.socket.send(value);
  }

  finish() {
    if (!this.started || this.ended || this.finishing) return;
    this.finishing = true;
    this.send("finish-task", { input: {} });
    this.timeout = setTimeout(() => this.fail("speech_timeout"), 30000);
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timeout);
    this.rejectReady(new Error("speech_cancelled"));
    this.socket.terminate();
    this.resolveDone();
  }

  private fail(code: string) {
    if (this.ended) return;
    this.emit({ type: "error", code });
    this.rejectReady(new Error(code));
    this.close();
  }
}

function providerErrorCode(code: string): string {
  if (/auth|api.?key|access.?denied/i.test(code)) return "speech_auth_failed";
  if (/limit|quota|throttl/i.test(code)) return "speech_rate_limited";
  return "speech_provider_failed";
}

import { apiRequest } from "../api/api-client.js";
import { DashscopeSession } from "./dashscope-session.js";
import type { SpeechEvent, SpeechMode } from "../../contracts/domain.js";
import type { SpeechConnection } from "./types.js";

type Task = {
  mode: SpeechMode;
  cancelled: boolean;
  session?: DashscopeSession;
  done: Promise<void>;
  resolve(): void;
};

/** Owns a window's speech tasks, including queued TTS and cancellation. */
export class SpeechService {
  private tasks = new Map<string, Task>();
  constructor(private emit: (id: string, event: SpeechEvent) => void) {}

  async start(id: string, mode: SpeechMode) {
    if ((mode !== "asr" && mode !== "tts") || typeof id !== "string")
      throw new Error("invalid_speech_request");
    let resolve!: () => void;
    const record: Task = {
      mode,
      cancelled: false,
      done: new Promise<void>((done) => {
        resolve = done;
      }),
      resolve: () => resolve(),
    };
    const previous = [...this.tasks.values()]
      .filter((item) => item.mode === "tts")
      .at(-1);
    this.tasks.set(id, record);
    try {
      // Preserve TTS order while previous synthesis flushes its remaining audio.
      if (mode === "tts") await previous?.done;
      if (record.cancelled) throw new Error("speech_cancelled");
      const connection = await apiRequest<SpeechConnection>(
        "/api/settings/speech/connection",
        { method: "POST", signal: AbortSignal.timeout(15000) },
      );
      if (record.cancelled) throw new Error("speech_cancelled");
      const session = new DashscopeSession(mode, connection, (event) =>
        this.emit(id, event),
      );
      record.session = session;
      void session.done.then(() => {
        this.tasks.delete(id);
        record.resolve();
      });
      await session.ready;
    } catch (error) {
      this.tasks.delete(id);
      record.resolve();
      throw error;
    }
  }

  append(id: string, value: string | Uint8Array) {
    this.tasks.get(id)?.session?.append(value);
  }
  finish(id: string) {
    this.tasks.get(id)?.session?.finish();
  }
  stop(mode?: SpeechMode) {
    for (const [id, record] of this.tasks) {
      if (mode && record.mode !== mode) continue;
      record.cancelled = true;
      record.session?.close();
      record.resolve();
      this.tasks.delete(id);
    }
  }
}

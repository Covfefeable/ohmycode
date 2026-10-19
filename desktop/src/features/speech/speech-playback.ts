/** Schedules raw mono PCM chunks without creating a new audio player for each frame. */
export class SpeechPlayback {
  private context: AudioContext | null = null;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private listeners = new Set<() => void>();
  private tasks = new Set<string>();
  private carry: number | null = null;
  private generation = 0;

  constructor(
    private onState: (playing: boolean) => void,
    private onError: (error: unknown) => void,
  ) {}

  async unlock() {
    this.context ??= new AudioContext({ sampleRate: 24000 });
    await this.context.resume();
  }

  task() {
    const id = crypto.randomUUID();
    const generation = this.generation;
    this.tasks.add(id);
    this.onState(true);
    const unsubscribe = window.ohmycode.speech.onEvent(id, (event) => {
      if (generation !== this.generation) return;
      if (event.type === "audio") this.audio(event.data);
      if (event.type === "finished" || event.type === "error") {
        unsubscribe();
        this.listeners.delete(unsubscribe);
        this.tasks.delete(id);
        if (event.type === "error") this.fail(new Error(event.code));
        else this.updateState();
      }
    });
    this.listeners.add(unsubscribe);
    const ready = window.ohmycode.speech.start(id, "tts");
    const send = (action: () => void) => {
      void ready
        .then(() => {
          if (generation === this.generation) action();
        })
        .catch((error: unknown) => {
          if (generation === this.generation) this.fail(error);
        });
    };
    // Handle a failed startup even when no text follows it.
    send(() => {});
    return {
      append: (text: string) =>
        send(() => window.ohmycode.speech.append(id, text)),
      finish: () => send(() => window.ohmycode.speech.finish(id)),
    };
  }

  private audio(bytes: Uint8Array) {
    const context = this.context;
    if (!context) return;
    const data =
      this.carry === null ? bytes : new Uint8Array([this.carry, ...bytes]);
    this.carry = data.length % 2 ? data[data.length - 1] : null;
    const length = Math.floor(data.length / 2);
    if (!length) return;
    const buffer = context.createBuffer(1, length, 24000);
    const samples = buffer.getChannelData(0);
    const view = new DataView(data.buffer, data.byteOffset, length * 2);
    for (let i = 0; i < length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      this.updateState();
    };
    this.nextTime = Math.max(this.nextTime, context.currentTime + 0.04);
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  private updateState() {
    this.onState(this.tasks.size > 0 || this.sources.size > 0);
  }
  private fail(error: unknown) {
    this.stop();
    this.onError(error);
  }

  stop() {
    this.generation++;
    window.ohmycode.speech.stop("tts");
    for (const unsubscribe of this.listeners) unsubscribe();
    this.listeners.clear();
    this.tasks.clear();
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
    this.carry = null;
    this.onState(false);
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }
}

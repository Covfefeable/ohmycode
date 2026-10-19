/** Partial ASR needs sustained audio; a final ASR result confirms speech itself. */
export class SpeechActivity {
  private duration = 0;
  private qualified = false;
  private recognized = false;
  private notified = false;

  constructor(private onSpeech: () => void) {}

  audio(level: number, durationMs: number) {
    this.duration = level > 0.08 ? this.duration + durationMs : 0;
    if (this.duration >= 400) this.qualified = true;
    this.notify();
  }

  transcript(text: string, final = false) {
    this.recognized = Boolean(text.trim());
    if (final && this.recognized) this.qualified = true;
    this.notify();
  }

  get accepted() { return this.qualified && this.recognized; }

  reset() {
    this.duration = 0;
    this.qualified = false;
    this.recognized = false;
    this.notified = false;
  }

  private notify() {
    if (!this.accepted || this.notified) return;
    this.notified = true;
    this.onSpeech();
  }
}

import type { FollowupInput, FollowupState } from "@ohmycode/protocol";

/** One serialized queue per thread; host adapters own persistence and execution. */
export class FollowupQueue {
  private state: FollowupState;
  constructor(initial: FollowupState, private readonly publish: (state: FollowupState) => void) {
    this.state = structuredClone(initial);
  }
  snapshot(): FollowupState { return structuredClone(this.state); }
  private changed(): void { this.publish(this.snapshot()); }
  add(input: FollowupInput): void {
    this.state.inputs.push(structuredClone(input));
    this.changed();
  }
  reserve(turnId?: string): FollowupInput | undefined {
    if (this.state.paused || this.state.inputs.some((item) => item.status !== "queued")) return;
    const input = this.state.inputs[0];
    if (!input) return;
    input.status = "sending";
    input.turnId = turnId;
    this.changed();
    return structuredClone(input);
  }
  steer(id: string, turnId?: string): FollowupInput {
    const input = this.state.inputs.find((item) => item.id === id);
    if (!input || input.status !== "queued") throw new Error("input_not_queued");
    input.status = "steering";
    input.turnId = turnId;
    this.changed();
    return structuredClone(input);
  }
  withdraw(id: string): FollowupInput {
    const input = this.state.inputs.find((item) => item.id === id);
    if (!input || input.status !== "queued") throw new Error("input_not_queued");
    this.remove(id);
    return structuredClone(input);
  }
  remove(id: string): void {
    this.state.inputs = this.state.inputs.filter((item) => item.id !== id);
    this.changed();
  }
  reset(id: string): void {
    const input = this.state.inputs.find((item) => item.id === id);
    if (input) { input.status = "queued"; delete input.turnId; }
    this.changed();
  }
  pause(): void { this.state.paused = true; this.changed(); }
  resume(): void { this.state.paused = false; this.changed(); }
}

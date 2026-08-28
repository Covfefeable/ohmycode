type EventInitLike = { bubbles?: boolean; cancelable?: boolean; composed?: boolean };
type MessageEventInitLike<T> = EventInitLike & {
  data?: T;
  lastEventId?: string;
  origin?: string;
};
type Listener = ((event: Event) => void) | { handleEvent(event: Event): void };

class MobileEvent {
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly defaultPrevented = false;
  readonly timeStamp = Date.now();
  readonly type: string;

  constructor(type: string, init: EventInitLike = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.composed = Boolean(init.composed);
  }

  preventDefault(): void {}
  stopImmediatePropagation(): void {}
  stopPropagation(): void {}
}

class MobileMessageEvent<T = unknown> extends MobileEvent {
  readonly data: T | undefined;
  readonly lastEventId: string;
  readonly origin: string;

  constructor(type: string, init: MessageEventInitLike<T> = {}) {
    super(type, init);
    this.data = init.data;
    this.lastEventId = init.lastEventId ?? "";
    this.origin = init.origin ?? "";
  }
}

class MobileEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    return !event.defaultPrevented;
  }
}

export function ensureEventGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals.Event !== "function") globals.Event = MobileEvent;
  if (typeof globals.MessageEvent !== "function") globals.MessageEvent = MobileMessageEvent;
  if (typeof globals.EventTarget !== "function") globals.EventTarget = MobileEventTarget;
}

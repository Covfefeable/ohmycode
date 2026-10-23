import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import type { AndroidTouch } from "@ohmycode/android-use/types";

export function useAndroidPointer(conversationId: string, size: { width: number; height: number } | null, active: boolean, onError: (error: unknown) => void) {
  const pressed = useRef<{ pointerId: number; touch: AndroidTouch } | null>(null);
  const send = useCallback((events: AndroidTouch[]) => {
    for (let at = 0; at < events.length; at += 256) void window.ohmycode.android.touch(conversationId, events.slice(at, at + 256)).catch(onError);
  }, [conversationId, onError]);
  const release = useCallback(() => {
    const current = pressed.current;
    pressed.current = null;
    if (current) void window.ohmycode.android.touch(conversationId, [{ ...current.touch, action: "up" }]).catch(() => {});
  }, [conversationId]);
  useEffect(() => {
    if (!active) return;
    const hide = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hide);
    return () => { release(); window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", hide); };
  }, [active, size, release]);
  function point(event: { clientX: number; clientY: number }, element: HTMLCanvasElement, action: AndroidTouch["action"]): AndroidTouch {
    const bounds = element.getBoundingClientRect();
    return { action, x: Math.max(0, Math.min(size!.width - 1, Math.round((event.clientX - bounds.left) / bounds.width * size!.width))), y: Math.max(0, Math.min(size!.height - 1, Math.round((event.clientY - bounds.top) / bounds.height * size!.height))), ...size! };
  }
  return {
    onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
      if (!active || !size || event.button !== 0 || pressed.current) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      const touch = point(event, event.currentTarget, "down");
      pressed.current = { pointerId: event.pointerId, touch };
      send([touch]);
    },
    onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
      if (!pressed.current || pressed.current.pointerId !== event.pointerId || !size) return;
      const coalesced = event.nativeEvent.getCoalescedEvents();
      const events = (coalesced.length ? coalesced : [event.nativeEvent]).map((sample) => point(sample, event.currentTarget, "move"));
      pressed.current.touch = events[events.length - 1];
      send(events);
    },
    onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
      if (!pressed.current || pressed.current.pointerId !== event.pointerId || !size) return;
      pressed.current = null;
      send([point(event, event.currentTarget, "up")]);
    },
    onPointerCancel: release,
    onLostPointerCapture: release,
  };
}

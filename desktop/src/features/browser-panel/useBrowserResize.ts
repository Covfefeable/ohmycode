import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

const storageKey = "ohmycode.browserPanelWidth";

export function useBrowserResize(panel: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(storageKey)) || undefined);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  function clamp(value: number) {
    const available = panel.current!.parentElement!.getBoundingClientRect().width;
    return Math.max(available * 0.15, Math.min(available * 0.75, value));
  }

  function save(value: number) {
    setWidth(value);
    localStorage.setItem(storageKey, String(value));
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const element = panel.current!;
    const startWidth = element.getBoundingClientRect().width;
    const startX = event.clientX;
    let next = startWidth;
    handle.setPointerCapture(event.pointerId);
    const previousCursor = document.documentElement.style.cursor;
    const previousSelection = document.documentElement.style.userSelect;
    document.documentElement.style.cursor = "col-resize";
    document.documentElement.style.userSelect = "none";
    const move = (pointer: globalThis.PointerEvent) => {
      next = clamp(startWidth + startX - pointer.clientX);
      element.style.setProperty("--browser-panel-width", `${next}px`);
    };
    const clear = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      handle.removeEventListener("lostpointercapture", stop);
      document.documentElement.style.cursor = previousCursor;
      document.documentElement.style.userSelect = previousSelection;
      cleanup.current = undefined;
    };
    const stop = () => { clear(); save(next); };
    cleanup.current = clear;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("lostpointercapture", stop);
  }

  function nudge(direction: number) {
    save(clamp(panel.current!.getBoundingClientRect().width + direction * 12));
  }

  return { width, start, nudge };
}

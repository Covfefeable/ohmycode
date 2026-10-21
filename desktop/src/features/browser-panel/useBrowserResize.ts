import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

const storageKey = "ohmycode.browserPanelWidth";

export function useBrowserResize(panel: RefObject<HTMLElement | null>, active: boolean) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(storageKey)) || undefined);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  useLayoutEffect(() => {
    if (!active) return;
    const element = panel.current!;
    const layout = element.parentElement!;
    const chatWidth = layout.getBoundingClientRect().width;
    const outsideWidth = window.innerWidth - chatWidth;
    let mounted = true;
    layout.style.setProperty("--browser-chat-min-width", `${chatWidth}px`);
    const initial = Number(localStorage.getItem(storageKey)) || chatWidth * 0.46;
    localStorage.setItem(storageKey, String(initial));
    element.style.setProperty("--browser-panel-width", `${initial}px`);
    void window.ohmycode.browser.reserveSpace(initial).then((baseWidth) => {
      if (mounted) layout.style.setProperty("--browser-chat-min-width", `${baseWidth - outsideWidth}px`);
    });
    return () => {
      mounted = false;
      layout.style.removeProperty("--browser-chat-min-width");
      void window.ohmycode.browser.reserveSpace(0);
    };
  }, [panel, active]);

  function clamp(value: number) {
    const available = Number.parseFloat(panel.current!.parentElement!.style.getPropertyValue("--browser-chat-min-width"));
    return Math.max(available * 0.15, Math.min(available * 1.5, value));
  }

  function save(value: number) {
    setWidth(value);
    localStorage.setItem(storageKey, String(value));
    void window.ohmycode.browser.reserveSpace(value);
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const element = panel.current!;
    const startWidth = element.getBoundingClientRect().width;
    const startX = event.screenX;
    let next = startWidth;
    handle.setPointerCapture(event.pointerId);
    const previousCursor = document.documentElement.style.cursor;
    const previousSelection = document.documentElement.style.userSelect;
    document.documentElement.style.cursor = "col-resize";
    document.documentElement.style.userSelect = "none";
    const move = (pointer: globalThis.PointerEvent) => {
      next = clamp(startWidth + startX - pointer.screenX);
      element.style.setProperty("--browser-panel-width", `${next}px`);
      void window.ohmycode.browser.reserveSpace(next);
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

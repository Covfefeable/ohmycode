import { useEffect, type RefObject } from "react";

/** Native views sit above DOM overlays; hide them while a modal overlaps the page. */
export function useBrowserViewport(id: string, ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const element = ref.current;
    let frame = 0;
    let previous = "";
    const measure = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const obscured = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')]
        .some((dialog) => dialog.getClientRects().length > 0);
      const visible = !obscured && box.width > 0 && box.height > 0 && document.visibilityState === "visible";
      const bounds = visible ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      const key = JSON.stringify(bounds);
      if (key !== previous) { previous = key; void window.ohmycode.browser.layout(id, bounds); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "hidden", "style"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      void window.ohmycode.browser.layout(null, null);
    };
  }, [active, id, ref]);
}

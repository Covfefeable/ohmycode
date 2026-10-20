export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
};

export type BrowserState = { tabs: BrowserTab[]; selectedId: string | null; opened: boolean };
export type BrowserBounds = { x: number; y: number; width: number; height: number };
export type BrowserCommand =
  | { action: "new"; url?: string }
  | { action: "select" | "close"; tabId: string }
  | { action: "navigate"; url: string }
  | { action: "back" | "forward" | "reload" };

export function browserUrl(value: string): string {
  if (value === "about:blank") return value;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("browser_unsupported_url");
  return url.href;
}

export function fitBounds(bounds: BrowserBounds, size: readonly number[]): BrowserBounds {
  const x = Math.max(0, Math.min(size[0], Math.round(bounds.x)));
  const y = Math.max(0, Math.min(size[1], Math.round(bounds.y)));
  return { x, y, width: Math.max(0, Math.min(size[0] - x, Math.round(bounds.width))), height: Math.max(0, Math.min(size[1] - y, Math.round(bounds.height))) };
}

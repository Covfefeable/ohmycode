import { useSyncExternalStore } from "react";

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
const WIDTH_KEY = "ohmycode.app-shell.sidebar-width";
const COLLAPSED_KEY = "ohmycode.app-shell.sidebar-collapsed";
const storedWidth = localStorage.getItem(WIDTH_KEY);
const width = storedWidth === null ? 300 : Number(storedWidth);
let state = {
  width: Number.isFinite(width) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)) : 300,
  collapsed: localStorage.getItem(COLLAPSED_KEY) === "true",
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

export function useSidebarState() { return useSyncExternalStore(subscribe, snapshot); }

export function setSidebarWidth(width: number) {
  state = { ...state, width };
  localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  listeners.forEach((listener) => listener());
}

export function toggleSidebar() {
  state = { ...state, collapsed: !state.collapsed };
  localStorage.setItem(COLLAPSED_KEY, String(state.collapsed));
  listeners.forEach((listener) => listener());
}

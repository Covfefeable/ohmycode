import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FullScreenLoading } from "./FullScreenLoading";
import styles from "./FullScreenLoading.module.css";

afterEach(() => vi.useRealTimers());

it("delays the skeleton to avoid flashing on fast requests", () => {
  vi.useFakeTimers();
  const view = render(<FullScreenLoading />);
  act(() => vi.advanceTimersByTime(179));
  expect(view.container.querySelector("i")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(view.container.querySelector("i")).not.toBeNull();
});

it("only renders navigation placeholders for full application startup", () => {
  vi.useFakeTimers();
  const view = render(<FullScreenLoading />);
  act(() => vi.advanceTimersByTime(180));
  expect(view.container.querySelector(`.${styles.sidebar}`)).toBeNull();
  expect(view.container.firstElementChild?.classList.contains(styles.fullScreen)).toBe(false);
  view.rerender(<FullScreenLoading kind="conversation" />);
  expect(view.container.querySelector(`.${styles.sidebar}`)).toBeNull();
  expect(view.container.querySelector(`.${styles.composer}`)).not.toBeNull();
  view.rerender(<FullScreenLoading kind="workspace" />);
  expect(view.container.querySelector(`.${styles.sidebar}`)).not.toBeNull();
  expect(view.container.firstElementChild?.classList.contains(styles.fullScreen)).toBe(true);
});

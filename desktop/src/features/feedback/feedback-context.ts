import { createContext } from "react";

export type FeedbackType = "success" | "error" | "info";
export type ToastInput = { type: FeedbackType; message: string; duration?: number };
export type NotificationInput = { type: FeedbackType; title: string; message: string };
export type FeedbackContextValue = {
  toast(input: ToastInput): void;
  notify(input: NotificationInput): void;
};
export const FeedbackContext = createContext<FeedbackContextValue | null>(null);


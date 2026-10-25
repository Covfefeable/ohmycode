import type { BrowserWindow, WebContents } from "electron";
import type { OperationFeedback } from "@ohmycode/tool-contracts";
import type { BrowserBounds } from "./types.js";

/** The application supplies its own presentation; no application imports in this package. */
export interface BrowserOperationOverlay {
  ready: Promise<void>;
  update(owner: BrowserWindow | null, bounds: BrowserBounds | null, feedback: OperationFeedback, page?: WebContents): void;
  close(): void;
}

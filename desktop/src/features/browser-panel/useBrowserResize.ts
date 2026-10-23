import type { RefObject } from "react";
import { useSidePanelResize } from "../../shared/hooks/useSidePanelResize";

export function useBrowserResize(panel: RefObject<HTMLElement | null>, active: boolean) {
  return useSidePanelResize(panel, active, "ohmycode.browserPanelWidth");
}

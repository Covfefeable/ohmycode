import { useParams } from "react-router-dom";
import { WindowControls } from "../../widgets/window-controls";
import { BrowserPanel } from "./BrowserPanel";
import { useBrowser } from "./useBrowser";

export function BrowserWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const id = conversationId!;
  const browser = useBrowser(id);
  return <><WindowControls /><BrowserPanel standalone conversationId={id} state={browser.state} active onClose={() => window.ohmycode.windowControls.close()} /></>;
}

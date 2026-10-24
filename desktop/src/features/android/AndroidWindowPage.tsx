import { WindowControls } from "../../widgets/window-controls";
import { useAndroidState } from "./useAndroidState";
import { AndroidPanel } from "./AndroidPanel";
import { useSearchParams } from "react-router-dom";

export function AndroidWindowPage() {
  const { state } = useAndroidState();
  const [params] = useSearchParams();
  return <><WindowControls />{state && <AndroidPanel conversationId={params.get("conversationId") ?? ""} standalone state={state} active onClose={() => window.ohmycode.windowControls.close()} />}</>;
}

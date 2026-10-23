import { WindowControls } from "../../widgets/window-controls";
import { useAndroidState } from "./useAndroidState";
import { AndroidPanel } from "./AndroidPanel";

export function AndroidWindowPage() {
  const { state } = useAndroidState();
  return <><WindowControls />{state && <AndroidPanel standalone state={state} active onClose={() => window.ohmycode.windowControls.close()} />}</>;
}

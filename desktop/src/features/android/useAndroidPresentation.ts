import { useEffect, useState } from "react";

export function useAndroidPresentation() {
  const [detached, setDetached] = useState(false);
  useEffect(() => {
    let received = false, mounted = true;
    const unsubscribe = window.ohmycode.android.onDetached((value) => { received = true; setDetached(value); });
    void window.ohmycode.android.detached().then((value) => { if (mounted && !received) setDetached(value); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return detached;
}

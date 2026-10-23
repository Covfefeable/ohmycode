import { useEffect, useState } from "react";
import type { AndroidState } from "@ohmycode/android-use/types";

export function useAndroidState() {
  const [state, setState] = useState<AndroidState | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = window.ohmycode.android.onState((next) => {
      received = true;
      setFailed(false);
      setState(next);
    });
    void window.ohmycode.android.state().then((next) => {
      if (active && !received) { setState(next); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; unsubscribe(); };
  }, [attempt]);
  return { state, failed, retry: () => setAttempt((value) => value + 1) };
}

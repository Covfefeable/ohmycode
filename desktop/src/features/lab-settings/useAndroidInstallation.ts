import { useEffect, useState } from "react";
import type { AndroidInstallPlan, AndroidInstallState } from "@ohmycode/android-use/types";

export function useAndroidInstallation() {
  const [state, setState] = useState<AndroidInstallState | null>(null);
  const [plan, setPlan] = useState<AndroidInstallPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let received = false;
    const off = window.ohmycode.android.onInstallation((next) => { received = true; setState(next); });
    void Promise.all([window.ohmycode.android.installation(), window.ohmycode.android.installPlan()]).then(([next, nextPlan]) => {
      if (!active) return;
      if (!received) setState(next);
      setPlan(nextPlan);
      setFailed(false);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; off(); };
  }, [attempt]);
  return {
    state, plan, failed,
    active: Boolean(state && !["idle", "completed", "error", "canceled"].includes(state.phase)),
    retry: () => setAttempt((value) => value + 1),
    chooseRoot: async () => { setPlan(await window.ohmycode.android.chooseInstallRoot()); },
  };
}

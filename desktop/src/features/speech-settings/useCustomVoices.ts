import { useEffect, useState } from "react";
const emptyVoices: CustomVoice[] = [];

export function useCustomVoices(workspaceId: string, configured: boolean) {
  const [snapshot, setSnapshot] = useState<{
    workspaceId: string;
    voices: CustomVoice[];
    failed: boolean;
  }>({ workspaceId, voices: [], failed: false });
  const voices =
    snapshot.workspaceId === workspaceId ? snapshot.voices : emptyVoices;
  const failed = snapshot.workspaceId === workspaceId && snapshot.failed;
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState({ revision: 0, refresh: false });

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const fetch = request.refresh
      ? window.ohmycode.speech.refreshVoices
      : window.ohmycode.speech.listVoices;
    void fetch()
      .then((items) => {
        if (active) setSnapshot({ workspaceId, voices: items, failed: false });
      })
      .catch(() => {
        if (active)
          setSnapshot((current) => ({
            workspaceId,
            voices: current.workspaceId === workspaceId ? current.voices : [],
            failed: true,
          }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, configured, request]);

  // Poll only while the provider reports review/processing, never recreate a voice.
  useEffect(() => {
    if (
      !configured ||
      failed ||
      !voices.some((voice) => voice.status === "DEPLOYING")
    )
      return;
    const timer = window.setTimeout(() => {
      setRequest((current) => ({
        revision: current.revision + 1,
        refresh: true,
      }));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [configured, voices, failed, workspaceId]);

  return {
    voices: configured ? voices : [],
    failed,
    loading,
    refresh() {
      setLoading(true);
      setRequest((current) => ({
        revision: current.revision + 1,
        refresh: true,
      }));
    },
    added(voice: CustomVoice) {
      setSnapshot((current) => ({
        workspaceId,
        voices: [
          ...(current.workspaceId === workspaceId ? current.voices : []),
          voice,
        ],
        failed: false,
      }));
    },
  };
}

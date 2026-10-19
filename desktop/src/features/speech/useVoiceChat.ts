import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { useSpeech } from "./speech-context";
import { useSpeechInput } from "./useSpeechInput";

const SEND_DELAY_MS = 1200;
const VOICE_ACTIVITY_LEVEL = 0.08;

export function useVoiceChat({ enabled, busy, onSubmit, onStop }: {
  enabled: boolean;
  busy: boolean;
  onSubmit(text: string): Promise<boolean | void>;
  onStop(): Promise<void>;
}) {
  const { playback, playing } = useSpeech();
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [sending, setSending] = useState(false);
  const transcript = useRef("");
  const final = useRef(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<ReturnType<typeof useSpeechInput> | null>(null);
  const actions = useRef({ enabled, send: async () => {} });
  const change = useCallback((value: string) => { transcript.current = value; setText(value); }, []);
  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setWaiting(false);
  }, []);
  const callbacks = useMemo(() => {
    function schedule() {
      cancelTimer();
      if (!actions.current.enabled || !inputRef.current?.active || !final.current || !transcript.current.trim() || pending.current) return;
      setWaiting(true);
      timer.current = setTimeout(() => { void actions.current.send(); }, SEND_DELAY_MS);
    }
    return {
      continuous: true,
      onEnd: cancelTimer,
      onSpeech() { playback.interrupt(); },
      onResult(value: boolean) {
        final.current = value;
        setConfirmed(value);
        schedule();
      },
      onLevel(value: number) {
        setLevel(value);
        if (value > VOICE_ACTIVITY_LEVEL && timer.current) schedule();
      },
    };
  }, [cancelTimer, playback]);
  const input = useSpeechInput(text, change, callbacks);

  const send = useCallback(async () => {
    if (!actions.current.enabled || pending.current || !transcript.current.trim()) return;
    cancelTimer();
    const content = inputRef.current?.takeText() || transcript.current;
    change("");
    playback.releaseInput();
    final.current = false;
    setConfirmed(false);
    pending.current = true;
    setSending(true);
    let succeeded = false;
    try {
      if (busy) await onStop();
      if (!actions.current.enabled) return;
      succeeded = (await onSubmit(content)) !== false;
    } catch {
      toast({ type: "error", message: t("speech.failed") });
    } finally {
      pending.current = false;
      setSending(false);
      if (!succeeded && actions.current.enabled) {
        inputRef.current?.cancel();
        change([content, transcript.current].filter(Boolean).join("\n"));
        final.current = true;
        setConfirmed(true);
      } else if (final.current) callbacks.onResult(true);
    }
  }, [busy, callbacks, cancelTimer, change, onStop, onSubmit, playback, t, toast]);

  useLayoutEffect(() => {
    inputRef.current = input;
    actions.current = { enabled, send };
  });
  useEffect(() => {
    actions.current.enabled = enabled;
    if (enabled) void inputRef.current?.toggle();
    return () => {
      actions.current.enabled = false;
      clearTimeout(timer.current);
      inputRef.current?.cancel();
      playback.releaseInput();
      playback.stop();
    };
  }, [enabled, playback]);

  return {
    text, level, waiting, sending, playing, state: input.state,
    canSend: enabled && confirmed && Boolean(text.trim()) && !sending,
    send,
    toggleMicrophone() { cancelTimer(); void input.toggle(); },
    clear() {
      cancelTimer();
      input.takeText();
      playback.releaseInput();
      change("");
      final.current = false;
      setConfirmed(false);
    },
  };
}

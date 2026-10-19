import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { useSpeech } from "./speech-context";
import { speechErrorKey } from "./speech-error";

type Recording = {
  id: string;
  cancelled: boolean;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  unsubscribe?: () => void;
};

function releaseMedia(current: Recording) {
  current.stream?.getTracks().forEach((track) => track.stop());
  current.node?.disconnect();
  void current.context?.close();
  current.stream = undefined;
  current.context = undefined;
  current.node = undefined;
}

function cancelRecording(current: Recording) {
  current.cancelled = true;
  releaseMedia(current);
  current.unsubscribe?.();
  window.ohmycode.speech.stop("asr");
}

export function useSpeechInput(
  content: string,
  onChange: (text: string) => void,
) {
  const [state, setState] = useState<
    "idle" | "starting" | "recording" | "finishing"
  >("idle");
  const recording = useRef<Recording | null>(null);
  const { playback, settings, refresh, setRecording } = useSpeech();
  const { t } = useTranslation();
  const { toast } = useFeedback();

  function dispose() {
    const current = recording.current;
    if (!current) return;
    cancelRecording(current);
    recording.current = null;
    setRecording(false);
  }
  useEffect(
    () => () => {
      const current = recording.current;
      if (current) {
        cancelRecording(current);
        setRecording(false);
      }
    },
    [setRecording],
  );

  async function toggle() {
    if (state === "finishing") return;
    if (state === "starting") {
      dispose();
      setState("idle");
      return;
    }
    if (recording.current) {
      const current = recording.current;
      setState("finishing");
      // Flush the worklet's partial frame before finish-task.
      current.node!.port.postMessage("flush");
      return;
    }
    const current: Recording = { id: crypto.randomUUID(), cancelled: false };
    recording.current = current;
    setRecording(true);
    setState("starting");
    const base = content;
    const sentences = new Map<number, string>();
    try {
      const config = settings ?? (await refresh());
      if (!config.hasApiKey) throw new Error("speech_not_configured");
      playback.stop();
      current.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (current.cancelled) {
        releaseMedia(current);
        return;
      }
      current.context = new AudioContext({ sampleRate: 16000 });
      await current.context.audioWorklet.addModule(
        new URL("speech-capture.js", document.baseURI).href,
      );
      await current.context.resume();
      if (current.cancelled) {
        releaseMedia(current);
        return;
      }
      current.unsubscribe = window.ohmycode.speech.onEvent(
        current.id,
        (event) => {
          if (current.cancelled) return;
          if (event.type === "transcript") {
            sentences.set(event.sentenceId, event.text);
            const text = [...sentences]
              .sort(([a], [b]) => a - b)
              .map(([, value]) => value)
              .join("");
            onChange(base + (base && text ? " " : "") + text);
          }
          if (event.type === "finished" || event.type === "error") {
            if (event.type === "error")
              toast({
                type: "error",
                message: t(speechErrorKey(new Error(event.code))),
              });
            dispose();
            setState("idle");
          }
        },
      );
      await window.ohmycode.speech.start(current.id, "asr");
      if (current.cancelled) return;
      current.node = new AudioWorkletNode(current.context, "speech-capture");
      current.node.port.onmessage = ({
        data: frame,
      }: MessageEvent<{ data: ArrayBuffer; final: boolean }>) => {
        if (current.cancelled) return;
        if (frame.data.byteLength)
          window.ohmycode.speech.append(current.id, new Uint8Array(frame.data));
        if (frame.final) {
          window.ohmycode.speech.finish(current.id);
          releaseMedia(current);
        }
      };
      const source = current.context.createMediaStreamSource(current.stream);
      source.connect(current.node);
      // The processor emits silence; connecting it keeps audio processing active.
      current.node.connect(current.context.destination);
      setState("recording");
    } catch (error) {
      if (!current.cancelled) {
        dispose();
        setState("idle");
        toast({ type: "error", message: t(speechErrorKey(error)) });
      }
    }
  }
  return { state, active: state !== "idle", toggle };
}

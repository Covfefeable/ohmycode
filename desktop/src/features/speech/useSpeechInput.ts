import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { useSpeech } from "./speech-context";
import { speechErrorKey } from "./speech-error";
import { SpeechActivity } from "./speech-activity";

type Recording = {
  id: string;
  cancelled: boolean;
  finishing: boolean;
  text: string;
  completed: Promise<string | null>;
  resolve(text: string | null): void;
  takeText(): string;
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
  current.resolve(null);
  releaseMedia(current);
  current.unsubscribe?.();
  window.ohmycode.speech.stop("asr");
}

export function useSpeechInput(
  content: string,
  onChange: (text: string) => void,
  options?: {
    continuous: boolean;
    onResult(final: boolean): void;
    onSpeech(): void;
    onLevel(level: number): void;
    onEnd?(): void;
  },
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
    options?.onLevel(0);
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

  function finish(): Promise<string | null> {
    const current = recording.current;
    if (!current) return Promise.resolve(content);
    if (current.finishing) return current.completed;
    if (!current.node) return Promise.resolve(null);
    current.finishing = true;
    setState("finishing");
    // Flush the worklet's partial frame before finish-task.
    current.node.port.postMessage("flush");
    return current.completed;
  }

  async function toggle() {
    if (state === "finishing") return;
    if (state === "starting") {
      dispose();
      setState("idle");
      return;
    }
    if (recording.current) {
      void finish();
      return;
    }
    let resolve!: (text: string | null) => void;
    const completed = new Promise<string | null>((done) => { resolve = done; });
    let base = content;
    let sentThrough = -1;
    let lastFinal = false;
    const activity = new SpeechActivity(() => {
      options?.onSpeech();
      options?.onResult(lastFinal);
    });
    const sentences = new Map<number, string>();
    const current: Recording = {
      id: crypto.randomUUID(), cancelled: false, finishing: false,
      text: content, completed, resolve,
      takeText() {
        const text = current.text;
        sentThrough = Math.max(sentThrough, ...sentences.keys());
        sentences.clear();
        base = "";
        current.text = "";
        activity.reset();
        lastFinal = false;
        onChange("");
        return text;
      },
    };
    recording.current = current;
    setRecording(!options?.continuous);
    setState("starting");
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
      if (current.cancelled) return;
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
            if (event.sentenceId <= sentThrough) return;
            sentences.set(event.sentenceId, event.text);
            const text = [...sentences]
              .sort(([a], [b]) => a - b)
              .map(([, value]) => value)
              .join("");
            current.text = base + (base && text ? " " : "") + text;
            onChange(current.text);
            lastFinal = event.final;
            const wasAccepted = activity.accepted;
            activity.transcript(current.text, event.final);
            if (wasAccepted) options?.onResult(event.final);
          }
          if (event.type === "finished" || event.type === "error") {
            options?.onEnd?.();
            if (event.type === "finished") current.resolve(current.text);
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
        if (options && frame.data.byteLength) {
          const samples = new Int16Array(frame.data);
          const energy = samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0);
          const level = Math.min(1, Math.sqrt(energy / samples.length) * 5);
          options.onLevel(level);
          activity.audio(level, samples.length / 16);
        }
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
        options?.onEnd?.();
        dispose();
        setState("idle");
        toast({ type: "error", message: t(speechErrorKey(error)) });
      }
    }
  }
  return {
    state, active: state !== "idle", toggle, finish,
    takeText: () => recording.current?.takeText() ?? "",
    cancel: () => { dispose(); setState("idle"); },
  };
}

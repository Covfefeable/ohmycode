import { useEffect, useRef, useState } from "react";
import { wavRecording } from "./voice-recording";

type Capture = {
  cancelled: boolean;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  frames: ArrayBuffer[];
  samples: number;
};

function release(capture: Capture) {
  capture.cancelled = true;
  capture.stream?.getTracks().forEach((track) => track.stop());
  capture.node?.disconnect();
  void capture.context?.close();
  capture.stream = undefined;
  capture.node = undefined;
  capture.context = undefined;
}

export function useVoiceRecording() {
  const current = useRef<Capture | null>(null);
  const [state, setState] = useState<"idle" | "starting" | "recording" | "finishing">("idle");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => () => {
    if (current.current) release(current.current);
  }, []);

  function stop() {
    const capture = current.current;
    if (!capture?.node || capture.cancelled) return;
    setState("finishing");
    capture.node.port.postMessage("flush");
  }

  async function start() {
    if (current.current) return;
    const capture: Capture = { cancelled: false, frames: [], samples: 0 };
    current.current = capture;
    setState("starting");
    setError(null);
    setAudio(null);
    setSeconds(0);
    setLevel(0);
    try {
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (capture.cancelled) { release(capture); return; }
      capture.context = new AudioContext({ sampleRate: 16000 });
      await capture.context.audioWorklet.addModule(new URL("speech-capture.js", document.baseURI).href);
      if (capture.cancelled) return;
      await capture.context.resume();
      if (capture.cancelled) { release(capture); return; }
      capture.node = new AudioWorkletNode(capture.context, "speech-capture");
      capture.node.port.onmessage = ({ data }: MessageEvent<{ data: ArrayBuffer; final: boolean }>) => {
        if (capture.cancelled) return;
        const remaining = 16000 * 30 - capture.samples;
        const frame = data.data.slice(0, Math.max(0, remaining) * 2);
        capture.frames.push(frame);
        capture.samples += frame.byteLength / 2;
        setSeconds(capture.samples / 16000);
        const samples = new Int16Array(frame);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / (samples.length || 1));
        setLevel(Math.min(1, rms * 5));
        if (data.final || capture.samples >= 16000 * 30) {
          setAudio(wavRecording(capture.frames, 16000));
          release(capture);
          current.current = null;
          setState("idle");
          setLevel(0);
        }
      };
      capture.context.createMediaStreamSource(capture.stream).connect(capture.node);
      capture.node.connect(capture.context.destination);
      setState("recording");
    } catch (failure) {
      const cancelled = capture.cancelled;
      release(capture);
      current.current = null;
      if (cancelled) return;
      setError(failure);
      setState("idle");
    }
  }

  return { state, audio, seconds, level, error, start, stop };
}

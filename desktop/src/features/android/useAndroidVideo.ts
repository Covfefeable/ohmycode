import { useEffect, useMemo, useState, type RefObject } from "react";
import type { AndroidVideoPacket } from "@ohmycode/android-use";
import { androidErrorKey } from "./android-error";

/** Annex-B H.264 stays encoded over IPC; Chromium decodes into the canvas. */
export function useAndroidVideo(canvas: RefObject<HTMLCanvasElement | null>, conversationId: string, active: boolean, attempt: number) {
  const session = useMemo(() => ({ id: crypto.randomUUID(), active, attempt, conversationId }), [active, attempt, conversationId]);
  const [view, setView] = useState<{ id: string; error?: string; size: { width: number; height: number } | null }>({ id: "", size: null });
  useEffect(() => {
    if (!active) return;
    const id = crypto.randomUUID();
    let closed = false;
    let configuration: Uint8Array | undefined;
    let waitingForKeyframe = true;
    const fail = (error?: unknown) => {
      if (closed) return;
      const key = androidErrorKey(error);
      setView({ id: session.id, error: key === "android.errors.android_operation_failed" ? "android.videoFailed" : key, size: null });
      void window.ohmycode.android.stopVideo(id);
    };
    const decoder = new VideoDecoder({
      output(frame) {
        try {
          const target = canvas.current;
          if (!target || closed) return;
          if (target.width !== frame.displayWidth || target.height !== frame.displayHeight) {
            target.width = frame.displayWidth; target.height = frame.displayHeight;
          }
          setView((current) => current.id === session.id && current.size?.width === target.width && current.size.height === target.height ? current : { id: session.id, size: { width: target.width, height: target.height } });
          target.getContext("2d")!.drawImage(frame, 0, 0);
        } finally { frame.close(); }
      }, error: fail,
    });
    function receive(packet: AndroidVideoPacket | { error: string }) {
      if (closed) return;
      if ("error" in packet) { fail(); return; }
      try {
        if (packet.configuration) {
          configuration = packet.data;
          decoder.reset();
          const bytes = packet.data;
          let profile: string | undefined;
          for (let i = 0; i + 6 < bytes.length; i++) {
            if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1 && (bytes[i + 3] & 31) === 7) {
              profile = Array.from(bytes.slice(i + 4, i + 7), (value) => value.toString(16).padStart(2, "0")).join(""); break;
            }
          }
          if (!profile) throw new Error("android_video_protocol");
          decoder.configure({ codec: `avc1.${profile}`, optimizeForLatency: true });
          waitingForKeyframe = true;
          return;
        }
        if (!configuration) return;
        if (decoder.decodeQueueSize > 6) receive({ ...packet, configuration: true, data: configuration });
        if (waitingForKeyframe && !packet.keyframe) return;
        let data = packet.data;
        if (waitingForKeyframe) {
          data = new Uint8Array(configuration.length + packet.data.length);
          data.set(configuration); data.set(packet.data, configuration.length);
          waitingForKeyframe = false;
        }
        decoder.decode(new EncodedVideoChunk({ type: packet.keyframe ? "key" : "delta", timestamp: packet.timestamp, data }));
      } catch { fail(); }
    }
    const unsubscribe = window.ohmycode.android.onVideo(id, receive);
    void window.ohmycode.android.startVideo(id, conversationId).catch(fail);
    return () => {
      closed = true; unsubscribe();
      if (decoder.state !== "closed") decoder.close();
      void window.ohmycode.android.stopVideo(id);
    };
  }, [canvas, active, session, conversationId]);
  return view.id === session.id ? { size: view.size, error: view.error } : { size: null, error: undefined };
}

import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";
import animationData from "../../assets/voice-orb.json";
import { useSpeech } from "../speech/speech-context";
import styles from "./VoiceOrb.module.css";

export function VoiceOrb({ level, waiting, processing }: { level: number; waiting: boolean; processing: boolean }) {
  const { playback } = useSpeech();
  const container = useRef<HTMLDivElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const speed = useRef(1);
  const activity = useRef({ level, waiting, processing });
  useEffect(() => { activity.current = { level, waiting, processing }; }, [level, waiting, processing]);

  useEffect(() => {
    let disposed = false;
    void import("lottie-web").then(({ default: lottie }) => {
      if (disposed) return;
      animation.current = lottie.loadAnimation({
        container: container.current!,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData,
      });
      animation.current.setSpeed(speed.current);
    });
    return () => { disposed = true; animation.current?.destroy(); animation.current = null; };
  }, []);

  useEffect(() => {
    let frame = 0;
    let displayed = 1;
    let previousTime = 0;
    let phaseStart = 0;
    let previousMode = "idle";
    const draw = (time: number) => {
      const { level, waiting, processing } = activity.current;
      const output = playback.readLevel();
      const speaking = level > 0.08 || output > 0.01;
      const mode = speaking ? "speaking" : waiting ? "waiting" : processing ? "processing" : "idle";
      const nextSpeed = mode === "waiting" ? 0.5 : 1;
      if (nextSpeed !== speed.current) {
        speed.current = nextSpeed;
        animation.current?.setSpeed(nextSpeed);
      }
      if (mode !== previousMode) { phaseStart = time; previousMode = mode; }
      const elapsed = time - phaseStart;
      const volume = Math.min(1, Math.sqrt(Math.max(level, output)) * 1.5);
      const target = mode === "speaking" ? 1 + volume * 0.28
        : mode === "waiting" ? 0.8 + Math.sin(elapsed / 1200 * Math.PI * 2) * 0.06
        : mode === "processing" ? 0.97 + Math.sin(elapsed / 1800 * Math.PI * 2) * 0.03 : 1;
      // Time-based smoothing keeps transitions consistent across screen refresh rates.
      const delta = previousTime ? time - previousTime : 16;
      previousTime = time;
      displayed += (target - displayed) * (1 - Math.exp(-delta / (speaking ? 45 : 140)));
      container.current!.style.transform = `scale(${displayed})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playback]);

  return <div className={styles.stage} aria-hidden="true">
    <div ref={container} className={styles.orb} />
  </div>;
}
